# Mutation Request Guards

## Purpose

Defines the checks every gift mutation request must pass before any business logic runs: a JSON media type, a same-origin request, and distributed rate limits. It also defines the standard JSON envelope that application API routes use for success and error responses. It applies to `POST /api/gifts`, `PATCH /api/gifts/{publicId}`, and `POST /api/gifts/{publicId}/claim`; media mutation endpoints reuse the media-type and origin checks, and media upload initialization also uses the rate limiter. Endpoint-specific behavior is specified in `gift-drafts` and `gift-draft-ownership`.

## Requirements

### Requirement: JSON media type required

Guarded mutation endpoints SHALL check the media type before any other check. They SHALL accept only requests whose `Content-Type` media type is `application/json`. The comparison is case-insensitive, and parameters such as `charset` are ignored. Any other or missing `Content-Type` SHALL be rejected with HTTP `415`, code `VALIDATION_ERROR`, and the message `Content-Type must be application/json.`

#### Scenario: Plain-text body rejected

- **WHEN** `POST /api/gifts` is sent with `Content-Type: text/plain`
- **THEN** the response is `415` with code `VALIDATION_ERROR`

#### Scenario: Charset parameter allowed

- **WHEN** a mutation is sent with `Content-Type: application/json; charset=utf-8`
- **THEN** the media type check passes

### Requirement: Same-origin and Fetch Metadata checks

Guarded mutation endpoints SHALL reject cross-origin browser requests with HTTP `403` and code `FORBIDDEN`:

- A `Sec-Fetch-Site` header with any value other than `same-origin` or `none` SHALL be rejected.
- When an `Origin` header is present, it MUST be an `http` or `https` origin equal to the request's effective origin. The effective origin uses the protocol from the first `X-Forwarded-Proto` value when it is `http` or `https`, falling back to the request URL protocol. It uses the host from the first `X-Forwarded-Host` value, falling back to `Host`, then to the request URL host. Both origins are normalized, so host case and default ports are ignored. A mismatch, an invalid origin, or an invalid host SHALL be rejected with the message `The request origin is not trusted.`
- A request that has neither header SHALL pass these checks.

#### Scenario: Cross-site request rejected

- **WHEN** a mutation arrives with `Origin: https://attacker.example.test` and `Sec-Fetch-Site: same-site`
- **THEN** the response is `403` with code `FORBIDDEN`

#### Scenario: Same origin behind a proxy

- **WHEN** a mutation reaches `http://internal:3000` with `Origin: https://love.example.test`, `X-Forwarded-Proto: https`, and `X-Forwarded-Host: LOVE.EXAMPLE.TEST:443`
- **THEN** the origin check passes

#### Scenario: Invalid forwarded host

- **WHEN** `X-Forwarded-Host` contains an invalid host value and an `Origin` header is present
- **THEN** the response is `403` with code `FORBIDDEN`

### Requirement: Distributed mutation rate limits

The system SHALL apply fixed-window rate limits to mutations, with counters stored in the shared database so limits hold across server instances. Each counter SHALL be incremented atomically and SHALL expire when its window ends. The limits per scope are:

| Scope          | Endpoint                           | Limit                       |
| -------------- | ---------------------------------- | --------------------------- |
| `gift-create`  | `POST /api/gifts`                  | 10 requests per 600 seconds |
| `gift-update`  | `PATCH /api/gifts/{publicId}`      | 60 requests per 60 seconds  |
| `gift-claim`   | `POST /api/gifts/{publicId}/claim` | 10 requests per 300 seconds |
| `media-upload` | media upload initialization        | 30 requests per 600 seconds |

Windows SHALL align to multiples of the window length. The limit SHALL be checked after the media-type, origin, path, and required-header checks, and before the request body is parsed. A request over the limit SHALL be rejected with HTTP `429`, code `RATE_LIMITED`, `details.retryAfterSeconds`, and a `Retry-After` header. Both carry the number of seconds until the current window ends, with a minimum of 1.

#### Scenario: Create limit exceeded

- **WHEN** the same subject sends an eleventh `POST /api/gifts` within one 600-second window
- **THEN** the response is `429` with code `RATE_LIMITED`, `error.details.retryAfterSeconds`, and a matching `Retry-After` header

### Requirement: Rate-limit subjects and key hashing

The system SHALL choose one rate-limit subject per request, in this order:

1. The signed-in user ID (`user:` subject).
2. Otherwise, the anonymous draft ID from a valid `love_memory_anonymous_draft` cookie (`anonymous:` subject).
3. Otherwise, the client IP from the first value of the trusted `x-vercel-forwarded-for` header, when it is a valid IP address of at most 64 characters (`ip:` subject).

The untrusted `x-forwarded-for` header MUST NOT be used as a subject. When no subject can be determined, the request SHALL NOT be rate-limited. Subjects SHALL be stored only as keyed HMAC-SHA-256 hashes computed with the server auth secret, never in plaintext.

#### Scenario: Trusted forwarding header used for anonymous first create

- **WHEN** a request with no session and no anonymous cookie carries `x-vercel-forwarded-for: 203.0.113.10, 10.0.0.1` and `x-forwarded-for: 198.51.100.8`
- **THEN** the rate-limit subject is `ip:203.0.113.10`

#### Scenario: Only the untrusted header present

- **WHEN** a request with no session and no anonymous cookie carries only `x-forwarded-for`
- **THEN** no rate-limit subject is determined, and no mutation rate limit is applied

#### Scenario: Account takes precedence

- **WHEN** a signed-in creator also presents an anonymous draft cookie
- **THEN** the rate-limit subject is `user:<userId>`

### Requirement: Standard API response envelope

Application API routes SHALL return successful responses as `{ "data": <payload> }` and errors as `{ "error": { "code", "message", "requestId", "details"?, "fieldErrors"? } }`. The fields follow these rules:

- `code` is one of `CONFLICT`, `FORBIDDEN`, `INTERNAL_ERROR`, `NOT_FOUND`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`, `UNAUTHORIZED`, or `VALIDATION_ERROR`.
- `message` is 1 to 300 characters.
- `details` values are strings, numbers, or booleans.
- `fieldErrors` maps field paths to messages.

Every envelope response SHALL carry `Cache-Control: no-store`, `Content-Type: application/json; charset=utf-8`, and an `x-request-id` header equal to `requestId`.

#### Scenario: Error envelope shape

- **WHEN** any guarded mutation is rejected
- **THEN** the body is `{ "error": { ... } }` with a `code` from the allowed set, a non-empty `message`, and a `requestId` that matches the `x-request-id` response header
- **AND** the response carries `Cache-Control: no-store`

### Requirement: Request ID propagation

The system SHALL reuse a non-empty incoming `x-request-id` header of at most 128 characters as the response `requestId`. Otherwise it SHALL generate a new UUID.

#### Scenario: Oversized request ID replaced

- **WHEN** a request carries an `x-request-id` longer than 128 characters
- **THEN** the response `requestId` is a newly generated UUID

#### Scenario: Caller trace ID kept

- **WHEN** a request carries `x-request-id: trace-1`
- **THEN** the response `requestId` and `x-request-id` header are `trace-1`

### Requirement: Body parsing and unexpected failures

A request body that is not valid JSON SHALL be rejected with `400`, code `VALIDATION_ERROR`, and the message `Request body must be valid JSON.` A body that fails schema validation SHALL be rejected with `400`, code `VALIDATION_ERROR`, and `fieldErrors` keyed by dotted field path, or by `body` for root-level problems. On the gift draft endpoints, an unexpected server failure SHALL return `500` with code `INTERNAL_ERROR` and a generic message. The failure SHALL be logged only as an event name and the request ID, never with request data.

#### Scenario: Malformed JSON

- **WHEN** a guarded mutation with a valid `Content-Type` has the body `{`
- **THEN** the response is `400` with code `VALIDATION_ERROR` and the message `Request body must be valid JSON.`

#### Scenario: Unexpected persistence failure

- **WHEN** the database throws while a draft is being created
- **THEN** the response is `500` with code `INTERNAL_ERROR`, and no internal error details are returned
