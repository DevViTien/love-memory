# Spec Delta

## MODIFIED Requirements

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
