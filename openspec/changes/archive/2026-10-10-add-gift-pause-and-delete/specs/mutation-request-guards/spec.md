# Spec Delta

## MODIFIED Requirements

### Requirement: Distributed mutation rate limits

The system SHALL apply fixed-window rate limits to mutations, with counters stored in the shared database so limits hold across server instances. Each counter SHALL be incremented atomically and SHALL expire when its window ends. Concurrent requests that create the same new counter SHALL each be counted: a request that loses the race to create the counter SHALL be charged to the counter that the other request created, and SHALL be rejected only when that counter is over its limit. The limits per scope are:

| Scope            | Endpoint                                                    | Limit                       |
| ---------------- | ----------------------------------------------------------- | --------------------------- |
| `gift-create`    | `POST /api/gifts`                                           | 10 requests per 600 seconds |
| `gift-update`    | `PATCH /api/gifts/{publicId}`                               | 60 requests per 60 seconds  |
| `gift-claim`     | `POST /api/gifts/{publicId}/claim`                          | 10 requests per 300 seconds |
| `gift-preview`   | `POST /api/gifts/{publicId}/preview`                        | 30 requests per 600 seconds |
| `gift-publish`   | `POST /api/gifts/{publicId}/publish`                        | 10 requests per 600 seconds |
| `media-upload`   | media upload initialization                                 | 30 requests per 600 seconds |
| `admin-mfa`      | `POST /api/admin/mfa/verify`                                | 10 requests per 600 seconds |
| `gift-lifecycle` | `POST /api/gifts/{publicId}/pause`, `/resume` and `/delete` | 20 requests per 600 seconds |

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

#### Scenario: Admin step-up attempts limited

- **WHEN** the same admin sends an eleventh `POST /api/admin/mfa/verify` within one 600-second window
- **THEN** the response is `429` with code `RATE_LIMITED` and a `Retry-After` header, and the code is
  not checked

#### Scenario: Lifecycle limit exceeded

- **WHEN** the same subject sends a 21st pause, resume or delete request within one 600-second
  window
- **THEN** the response is `429` with code `RATE_LIMITED` and a `Retry-After` header, and the gift
  is unchanged
