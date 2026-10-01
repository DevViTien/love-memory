## MODIFIED Requirements

### Requirement: Distributed mutation rate limits

The system SHALL apply fixed-window rate limits to mutations, with counters stored in the shared database so limits hold across server instances. Each counter SHALL be incremented atomically and SHALL expire when its window ends. Concurrent requests that create the same new counter SHALL each be counted: a request that loses the race to create the counter SHALL be charged to the counter that the other request created, and SHALL be rejected only when that counter is over its limit. The limits per scope are:

| Scope          | Endpoint                             | Limit                       |
| -------------- | ------------------------------------ | --------------------------- |
| `gift-create`  | `POST /api/gifts`                    | 10 requests per 600 seconds |
| `gift-update`  | `PATCH /api/gifts/{publicId}`        | 60 requests per 60 seconds  |
| `gift-claim`   | `POST /api/gifts/{publicId}/claim`   | 10 requests per 300 seconds |
| `gift-preview` | `POST /api/gifts/{publicId}/preview` | 30 requests per 600 seconds |
| `gift-publish` | `POST /api/gifts/{publicId}/publish` | 10 requests per 600 seconds |
| `media-upload` | media upload initialization          | 30 requests per 600 seconds |

`POST /api/gifts/{publicId}/preview` and `POST /api/gifts/{publicId}/publish` are guarded mutation endpoints: they pass the media-type and origin checks of this capability and use the standard response envelope. Windows SHALL align to multiples of the window length. The limit SHALL be checked after the media-type, origin, path, and required-header checks, and before the request body is parsed. A request over the limit SHALL be rejected with HTTP `429`, code `RATE_LIMITED`, `details.retryAfterSeconds`, and a `Retry-After` header. Both carry the number of seconds until the current window ends, with a minimum of 1.

#### Scenario: Create limit exceeded

- **WHEN** the same subject sends an eleventh `POST /api/gifts` within one 600-second window
- **THEN** the response is `429` with code `RATE_LIMITED`, `error.details.retryAfterSeconds`, and a matching `Retry-After` header

#### Scenario: Concurrent first requests in a new window

- **WHEN** two requests of the same subject and scope arrive at the same time as the first two requests of a window
- **THEN** both are allowed, and the counter of that window holds `2`

#### Scenario: Preview limit exceeded

- **WHEN** the same subject sends a 31st `POST /api/gifts/{publicId}/preview` within one 600-second window
- **THEN** the response is `429` with code `RATE_LIMITED` and a `Retry-After` header, and no preview token is created

#### Scenario: Preview request from another site

- **WHEN** `POST /api/gifts/{publicId}/preview` arrives with `Origin: https://attacker.example.test`
- **THEN** the response is `403` with code `FORBIDDEN`, and the `gift-preview` counter is not incremented

#### Scenario: Publish limit exceeded

- **WHEN** the same signed-in user sends an eleventh `POST /api/gifts/{publicId}/publish` within one 600-second window
- **THEN** the response is `429` with code `RATE_LIMITED` and a `Retry-After` header, and nothing is published

#### Scenario: Publish request from another site

- **WHEN** `POST /api/gifts/{publicId}/publish` arrives with `Origin: https://attacker.example.test`
- **THEN** the response is `403` with code `FORBIDDEN`, the `gift-publish` counter is not incremented, and nothing is published

### Requirement: Rate-limit subjects and key hashing

The system SHALL choose one primary rate-limit subject per request, in this order:

1. The signed-in user ID (`user:` subject).
2. Otherwise, the anonymous draft ID from a valid `love_memory_anonymous_draft` cookie (`anonymous:` subject).
3. Otherwise, the client IP from the first value of the trusted `x-vercel-forwarded-for` header, when it is a valid IP address of at most 64 characters (`ip:` subject). The header is trusted only when the server runs on Vercel (environment variable `VERCEL` set to `1`), where the platform sets it; on any other host it MUST be ignored, because a client could send it.
4. Otherwise, the single shared `unidentified` subject.

Because an anonymous cookie is only checked for shape, a request whose primary subject is `anonymous:` SHALL also be charged to a network guard subject: `network:ip:<address>` from the trusted header when present, otherwise `network:unidentified`. Network guard subjects SHALL allow five times the scope's per-subject limit, and a request SHALL be rejected when any subject it is charged to is over its limit. The untrusted `x-forwarded-for` header MUST NOT be used as a subject. All requests that fall back to the `unidentified` subject SHALL share one counter per scope whose limit is five times that scope's per-subject limit, so unidentifiable traffic is bounded rather than unlimited. Subjects SHALL be stored only as keyed HMAC-SHA-256 hashes computed with the server auth secret, never in plaintext.

#### Scenario: Trusted forwarding header used for anonymous first create

- **WHEN** a request with no session and no anonymous cookie carries `x-vercel-forwarded-for: 203.0.113.10, 10.0.0.1` and `x-forwarded-for: 198.51.100.8`
- **THEN** the rate-limit subject is `ip:203.0.113.10`

#### Scenario: Only the untrusted header present

- **WHEN** a request with no session and no anonymous cookie carries only `x-forwarded-for`
- **THEN** the rate-limit subject is `unidentified`
- **AND** the request counts against the shared `unidentified` counter, which allows 50 `POST /api/gifts` requests per 600-second window

#### Scenario: Forwarding header off Vercel

- **WHEN** a request with no session and no anonymous cookie carries `x-vercel-forwarded-for: 203.0.113.10` on a server that is not running on Vercel
- **THEN** the rate-limit subject is `unidentified`

#### Scenario: Account takes precedence

- **WHEN** a signed-in creator also presents an anonymous draft cookie
- **THEN** the rate-limit subject is `user:<userId>` and no network guard is charged

#### Scenario: Forged anonymous cookies cannot reset the limit

- **WHEN** one client behind `x-vercel-forwarded-for: 203.0.113.10` sends 51 `POST /api/gifts` requests within 600 seconds, each with a different well-formed but made-up anonymous cookie
- **THEN** the 51st request is rejected with `429` because the `network:ip:203.0.113.10` guard allows 50

### Requirement: Body parsing and unexpected failures

A request body that is not valid JSON SHALL be rejected with `400`, code `VALIDATION_ERROR`, and the message `Request body must be valid JSON.` Bodies SHALL be read with a size cap, checked on `Content-Length` and while reading: 1 KiB for `POST /api/gifts/{publicId}/preview` and `POST /api/gifts/{publicId}/publish`, and 64 KiB for `PATCH /api/gifts/{publicId}`. A larger body SHALL be rejected with `413`, code `VALIDATION_ERROR` and the message `Request body is too large.`, without being parsed. A body that fails schema validation SHALL be rejected with `400`, code `VALIDATION_ERROR`, and `fieldErrors` keyed by dotted field path, or by `body` for root-level problems. On the gift draft, preview, publish and public gift endpoints, an unexpected server failure SHALL return `500` with code `INTERNAL_ERROR` and a generic message. The failure SHALL be logged only with an operation name, the error's class name (such as `MongoServerError`) and the request ID, never with request data, the error message, gift text, tokens, share ids or signed URLs.

#### Scenario: Malformed JSON

- **WHEN** a guarded mutation with a valid `Content-Type` has the body `{`
- **THEN** the response is `400` with code `VALIDATION_ERROR` and the message `Request body must be valid JSON.`

#### Scenario: Unexpected persistence failure

- **WHEN** the database throws while a draft is being created
- **THEN** the response is `500` with code `INTERNAL_ERROR`, and no internal error details are returned
- **AND** the log entry holds the operation name, the error class name and the request ID only

#### Scenario: Oversized publish body

- **WHEN** `POST /api/gifts/{publicId}/publish` arrives with a 2 KiB body
- **THEN** the response is `413` with code `VALIDATION_ERROR`, and nothing is published
