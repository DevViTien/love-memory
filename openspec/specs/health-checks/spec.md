# Health Checks

## Purpose

Defines the unauthenticated operational endpoints used by deployment tooling and operators to decide
whether the web application process is alive (`/api/health`) and whether it can serve traffic that
depends on its runtime configuration and MongoDB (`/api/health/ready`). It covers response shapes,
status codes, caching and the guarantee that failures never expose internal details. MongoDB
connection behavior itself is specified in `database-schema-management`.

## Requirements

### Requirement: Liveness endpoint

The system SHALL respond to `GET /api/health` with HTTP `200` and a JSON body
`{ "data": { "service", "status", "timestamp", "version" } }` where `service` is `love-memory`,
`status` is `ok`, `timestamp` is the current time as an ISO 8601 date-time string, and `version` is
the web application package version (currently `0.1.0`). The body SHALL contain no other fields. The
liveness endpoint MUST NOT contact MongoDB, object storage or any other dependency.

#### Scenario: Process is alive

- **WHEN** a client sends `GET /api/health`
- **THEN** the response status is `200`
- **AND** the body matches `{ "data": { "service": "love-memory", "status": "ok", "timestamp": <ISO date-time>, "version": "0.1.0" } }`

#### Scenario: Database outage does not affect liveness

- **WHEN** MongoDB is unreachable and a client sends `GET /api/health`
- **THEN** the response status is still `200` with `status` equal to `ok`

### Requirement: Readiness dependency checks

The system SHALL respond to `GET /api/health/ready` by evaluating, in order: the object storage
configuration (`BLOB_READ_WRITE_TOKEN` or `BLOB_STORE_ID` must be configured, and `BLOB_STORE_ID` is
required when `VERCEL_OIDC_TOKEN` is configured), the media worker configuration (`MEDIA_WORKER_MODE`,
when set, must be `inline` or `trigger`; the effective mode defaults to `trigger` when `NODE_ENV` is
`production` and `inline` otherwise; `TRIGGER_SECRET_KEY` is required in `trigger` mode), and a
MongoDB `ping` command against the configured database. Readiness SHALL NOT perform MongoDB reads or
writes of application data. Readiness SHALL be evaluated on every request and never served from a
prerendered or cached result.

#### Scenario: All dependencies ready

- **WHEN** storage and media worker configuration are valid and MongoDB answers `ping`
- **THEN** the response status is `200`
- **AND** the body has the same `{ "data": { "service", "status", "timestamp", "version" } }` shape as liveness with `status` equal to `ok`

#### Scenario: Missing storage configuration

- **WHEN** neither `BLOB_READ_WRITE_TOKEN` nor `BLOB_STORE_ID` is configured
- **THEN** the response status is `503`

#### Scenario: Trigger mode without secret

- **WHEN** the effective media worker mode is `trigger` and `TRIGGER_SECRET_KEY` is not set
- **THEN** the response status is `503`

#### Scenario: MongoDB unreachable

- **WHEN** configuration is valid but the MongoDB `ping` fails or MongoDB configuration is invalid
- **THEN** the response status is `503`

### Requirement: Safe readiness failure response

The system SHALL respond to any failed readiness check with HTTP `503` and exactly the JSON body
`{ "error": { "code": "INTERNAL_ERROR", "message": "Service dependencies are not ready.", "requestId": <id> } }`.
The response MUST NOT reveal which dependency failed, error messages, stack traces, connection
strings, tokens or other configuration values.

#### Scenario: Failure body is generic

- **WHEN** readiness fails because of an invalid `MONGODB_URI`
- **THEN** the body message is `Service dependencies are not ready.`
- **AND** the body contains no part of the configured URI or the underlying error message

### Requirement: Readiness failure logging

The system SHALL log each readiness failure server-side as `Readiness check failed` with only the
error name (or `UnknownError` for non-`Error` values) and the request identifier. The log entry MUST
NOT include the error message, stack or configuration values.

#### Scenario: Operator correlates a failed probe

- **WHEN** a readiness request fails
- **THEN** a server log entry `Readiness check failed` is written containing `errorName` and the same `requestId` returned to the client

### Requirement: Request identification

The system SHALL generate a new UUID v4 for every health or readiness request and return it in the
`x-request-id` response header; failed readiness responses SHALL also return it as
`error.requestId` in the body.

#### Scenario: Liveness returns a request id

- **WHEN** a client sends `GET /api/health`
- **THEN** the `x-request-id` header is a UUID v4

### Requirement: Health responses are not cached

The system SHALL send `Cache-Control: no-store` on every liveness and readiness response, whether
successful or failed.

#### Scenario: Readiness failure is not cached

- **WHEN** `GET /api/health/ready` returns `503`
- **THEN** the response includes `Cache-Control: no-store`

#### Scenario: Liveness is not cached

- **WHEN** `GET /api/health` returns `200`
- **THEN** the response includes `Cache-Control: no-store` and `Content-Type: application/json; charset=utf-8`
