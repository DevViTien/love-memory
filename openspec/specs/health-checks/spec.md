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
configuration for the selected `STORAGE_DRIVER` (see `local-object-storage`; for the default
`vercel-blob` driver `BLOB_READ_WRITE_TOKEN` or `BLOB_STORE_ID` must be configured, and
`BLOB_STORE_ID` is required when `VERCEL_OIDC_TOKEN` is configured; for the `local` driver
`LOCAL_OBJECT_STORAGE_SECRET` and `APP_URL` must be valid and `VERCEL_ENV` must be unset, empty or
`development`), the media worker configuration (`MEDIA_WORKER_MODE`, when set, must be `inline` or
`trigger`; the effective mode defaults to `trigger` when `NODE_ENV` is `production` and `inline`
otherwise; `TRIGGER_SECRET_KEY` is required in `trigger` mode; the effective mode must be `inline`
when the storage driver is `local`), and a MongoDB `ping` command against the configured database.
Readiness SHALL NOT perform MongoDB reads or writes of application data and SHALL NOT read or write
stored objects. Readiness SHALL be evaluated on every request and never served from a prerendered
or cached result.

#### Scenario: All dependencies ready

- **WHEN** storage and media worker configuration are valid and MongoDB answers `ping`
- **THEN** the response status is `200`
- **AND** the body has the same `{ "data": { "service", "status", "timestamp", "version" } }` shape as liveness with `status` equal to `ok`

#### Scenario: Missing storage configuration

- **WHEN** the storage driver is `vercel-blob` and neither `BLOB_READ_WRITE_TOKEN` nor `BLOB_STORE_ID` is configured
- **THEN** the response status is `503`

#### Scenario: Local storage without Blob credentials

- **WHEN** `STORAGE_DRIVER` is `local` with a valid `LOCAL_OBJECT_STORAGE_SECRET` and `APP_URL`,
  `MEDIA_WORKER_MODE` is `inline`, no Blob credential is configured and MongoDB answers `ping`
- **THEN** the response status is `200`

#### Scenario: Local storage on a Vercel deployment

- **WHEN** `STORAGE_DRIVER` is `local` and `VERCEL_ENV` is `production` or `preview`
- **THEN** the response status is `503`

#### Scenario: Local storage with Trigger.dev workers

- **WHEN** `STORAGE_DRIVER` is `local` and the effective media worker mode is `trigger`
- **THEN** the response status is `503`

#### Scenario: Trigger mode without secret

- **WHEN** the effective media worker mode is `trigger` and `TRIGGER_SECRET_KEY` is not set
- **THEN** the response status is `503`

#### Scenario: MongoDB unreachable

- **WHEN** configuration is valid but the MongoDB `ping` fails or MongoDB configuration is invalid
- **THEN** the response status is `503`

### Requirement: Safe readiness failure response

The system SHALL respond to any failed readiness check with HTTP `503` and exactly the JSON body
`{ "error": { "code": "SERVICE_UNAVAILABLE", "message": "Service dependencies are not ready.", "requestId": <id> } }`.
The response MUST NOT reveal which dependency failed, error messages, stack traces, connection
strings, tokens or other configuration values.

#### Scenario: Failure body is generic

- **WHEN** readiness fails because of an invalid `MONGODB_URI`
- **THEN** the body message is `Service dependencies are not ready.` with code `SERVICE_UNAVAILABLE`
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
