# Technical Spikes

## Purpose

Defines the protected Sprint 0 technical spike surfaces used to verify infrastructure risks
(MongoDB pooling and read/write, private object storage direct upload and image processing, and
template iframe isolation) against a real deployment. These surfaces are hidden unless explicitly
enabled, their mutation endpoints require a dedicated bearer token, and they never cache responses.
The policies applied to template documents are specified in `content-security-policy`; the
production media pipeline is out of scope.

## Requirements

### Requirement: Spike enablement configuration

The system SHALL treat technical spikes as disabled unless `TECHNICAL_SPIKES_ENABLED` is exactly
`true`. `TECHNICAL_SPIKES_ENABLED` MUST be `true`, `false` or unset; any other value SHALL be
rejected as invalid configuration. `TECHNICAL_SPIKE_TOKEN` is optional, an empty value SHALL be
treated as unset, and a configured token MUST be 24 to 256 characters long. When spikes are enabled
the token MUST be configured; otherwise the configuration SHALL be rejected with
`TECHNICAL_SPIKE_TOKEN is required when technical spikes are enabled.` Regardless of these
variables, technical spikes SHALL be disabled whenever `VERCEL_ENV` is `production`, so the spike
pages and endpoints behave exactly as when they are disabled.

#### Scenario: Disabled by default

- **WHEN** neither `TECHNICAL_SPIKES_ENABLED` nor `TECHNICAL_SPIKE_TOKEN` is set
- **THEN** technical spikes are disabled

#### Scenario: Enabled without token is invalid

- **WHEN** `TECHNICAL_SPIKES_ENABLED` is `true` and `TECHNICAL_SPIKE_TOKEN` is unset
- **THEN** reading the spike configuration fails with a validation error

#### Scenario: Production deployment ignores the enable flag

- **WHEN** `VERCEL_ENV` is `production` and `TECHNICAL_SPIKES_ENABLED` is `true` with a valid token
- **THEN** technical spikes are disabled and `/studio/spikes` responds `404`

### Requirement: Spike pages hidden when disabled

The system SHALL respond with HTTP `404`, an empty body, `Cache-Control: private, no-store` and the
route's `Content-Security-Policy` to any request for `/studio/spikes`, a path under
`/studio/spikes/`, `/template-spikes` or a path under `/template-spikes/` while technical spikes are
disabled. When spikes are enabled these pages SHALL be served normally; the `/studio/spikes` lab page
does not itself require the token, which is entered in the page and sent only to the spike API
endpoints.

#### Scenario: Disabled lab returns 404

- **WHEN** `TECHNICAL_SPIKES_ENABLED` is `false` and a browser requests `/studio/spikes`
- **THEN** the response status is `404`
- **AND** the response includes `Cache-Control: private, no-store`

#### Scenario: Enabled lab is served

- **WHEN** technical spikes are enabled with a valid token and a browser requests `/studio/spikes`
- **THEN** the lab page is rendered

#### Scenario: Unrelated Studio routes unaffected

- **WHEN** technical spikes are disabled and a browser requests `/studio/new`
- **THEN** the request is not rejected by the spike gate

### Requirement: Bearer token authorization for spike APIs

The system SHALL protect `POST /api/spikes/mongodb`, `POST /api/spikes/uploads/init`,
`POST /api/spikes/uploads/complete` and `POST /api/spikes/uploads/cleanup` before reading the request
body, as follows:

- when spikes are disabled or no token is configured, respond `404` with error code `NOT_FOUND` and
  message `Technical spike endpoint is disabled.`;
- when the `Authorization` header is missing, does not start with `Bearer ` (case-sensitive), or the
  presented token does not exactly equal `TECHNICAL_SPIKE_TOKEN`, respond `401` with error code
  `UNAUTHORIZED` and message `Technical spike authorization is required.`

Token comparison MUST be exact and MUST use a constant-time comparison for tokens of equal length.
Every spike API response SHALL use the envelope `{ "data": ... }` on success or
`{ "error": { "code", "message", "requestId" } }` on failure, with `Cache-Control: no-store`,
`Content-Type: application/json; charset=utf-8` and a new UUID in `x-request-id`. Failures SHALL be
logged server-side with only the operation name, error name and request identifier, and response
bodies MUST NOT include underlying error messages or secrets.

#### Scenario: Correct token authorized

- **WHEN** spikes are enabled and a request sends `Authorization: Bearer <TECHNICAL_SPIKE_TOKEN>`
- **THEN** the request proceeds to the spike operation

#### Scenario: Wrong token rejected

- **WHEN** spikes are enabled and a request sends `Authorization: Bearer wrong`
- **THEN** the response status is `401` with error code `UNAUTHORIZED`

#### Scenario: Disabled endpoint hidden

- **WHEN** spikes are disabled and any request is sent to `POST /api/spikes/mongodb`, even with a bearer token
- **THEN** the response status is `404` with error code `NOT_FOUND`

### Requirement: MongoDB read/write probe

The system SHALL, on an authorized `POST /api/spikes/mongodb`, obtain the database client twice
concurrently, insert a probe document with a random identifier and `kind` `read-write-probe` into
`technicalSpikes`, read it back, and delete it regardless of the outcome. It SHALL respond `200`
with `{ "data": { "connectionReused": true, "readVerified": true, "writeVerified": true } }` only
when both client acquisitions returned the same client, the insert was acknowledged with the
expected identifier and the read returned that identifier. Any unverified invariant or error SHALL
produce `503` with error code `SERVICE_UNAVAILABLE` and message
`Database read/write verification failed.`

#### Scenario: Probe verifies pooling and read/write

- **WHEN** an authorized probe runs against a healthy database
- **THEN** the response status is `200` and all three flags are `true`
- **AND** no probe document remains in `technicalSpikes`

#### Scenario: Probe invariant fails

- **WHEN** the probe cannot read back the written document
- **THEN** the response status is `503` with error code `SERVICE_UNAVAILABLE`

### Requirement: Spike direct upload initialization

The system SHALL, on an authorized `POST /api/spikes/uploads/init` with a strict JSON body
`{ contentType, fileName, sizeBytes }`, where `contentType` is `image/jpeg`, `image/png` or
`image/webp`, `fileName` is 1 to 255 characters after trimming with no `/`, `\` or control
characters, and `sizeBytes` is a positive integer no greater than `10485760`, create a random UUID
asset id and a signed direct-upload URL for the private object key `private/spikes/<assetId>/source`
that is bound to the declared content type and size and expires after `300` seconds. It SHALL
respond `201` with `{ "data": { "assetId", "expiresAt", "headers", "method": "PUT", "uploadUrl" } }`.
A body that is not valid JSON SHALL produce `400` `VALIDATION_ERROR` with message
`Request body must be valid JSON.`; a body failing validation SHALL produce `400` `VALIDATION_ERROR`
with message `Request body validation failed.` and per-field `fieldErrors`; a storage failure SHALL
produce `503` `SERVICE_UNAVAILABLE` with message `Upload storage is not configured or available.`

#### Scenario: Valid upload request

- **WHEN** an authorized client posts `{ "contentType": "image/jpeg", "fileName": "ky-niem.jpg", "sizeBytes": 1024 }`
- **THEN** the response status is `201` with `method` equal to `PUT` and an `expiresAt` 300 seconds in the future

#### Scenario: Executable format rejected

- **WHEN** an authorized client declares `contentType` `image/svg+xml`
- **THEN** the response status is `400` with error code `VALIDATION_ERROR`

### Requirement: Spike upload completion and processing

The system SHALL, on an authorized `POST /api/spikes/uploads/complete` with strict body
`{ assetId }` (a UUID), verify that the private source object exists with a size greater than zero
and at most `10485760` bytes and an allowed image content type, decode it, require the decoded
format to match the declared content type, store a WebP derivative at
`processed/spikes/<assetId>/w768.webp`, delete the source, and respond `200` with
`{ "data": { "assetId", "contentType": "image/webp", "downloadUrl", "height", "width" } }` where
`downloadUrl` is a signed private download URL. If the source no longer exists but the derivative
does, the call SHALL succeed again from the stored derivative so that retries after a lost response
are idempotent. A source that fails verification or decoding SHALL be deleted and SHALL produce
`422` `VALIDATION_ERROR` with message `Uploaded object failed media validation.`; other failures SHALL
produce `503` `SERVICE_UNAVAILABLE` with message `Media processing is not available.`

#### Scenario: Valid image processed

- **WHEN** an authorized client completes an upload whose source is a valid PNG declared as `image/png`
- **THEN** the response status is `200` with `contentType` equal to `image/webp`
- **AND** the source object has been deleted

#### Scenario: Declared type mismatch rejected

- **WHEN** the uploaded bytes decode as a different format than the declared content type
- **THEN** the response status is `422` with error code `VALIDATION_ERROR`
- **AND** the source object has been deleted

#### Scenario: Completion retried after success

- **WHEN** an authorized client repeats the completion request for an already processed asset
- **THEN** the response status is `200` with `contentType` equal to `image/webp` and a fresh `downloadUrl`

### Requirement: Spike object cleanup

The system SHALL, on an authorized `POST /api/spikes/uploads/cleanup` with strict body `{ assetId }`
(a UUID), attempt to delete both the source and the derivative objects for that asset and respond
`200` with `{ "data": { "assetId", "deleted": true } }` only when both deletions succeed; if either
deletion fails it SHALL respond `503` `SERVICE_UNAVAILABLE` with message
`Media cleanup is not available.`

#### Scenario: Verifier cleans up its objects

- **WHEN** an authorized client posts a cleanup request for a processed spike asset
- **THEN** the response status is `200` with `deleted` equal to `true`

### Requirement: Template isolation spike documents

The system SHALL, while technical spikes are enabled, serve `GET /template-spikes/memory-box` as an
HTML document (`text/html; charset=utf-8`) that loads `runtime.mjs`, and `GET
/template-spikes/runtime.mjs` as JavaScript (`text/javascript; charset=utf-8`) with
`Access-Control-Allow-Origin: *` and `X-Content-Type-Options: nosniff`, so that the lab can embed the
document in an iframe sandboxed with only `allow-scripts`. Both responses SHALL carry
`Cache-Control: private, no-store`, and both SHALL respond `404` with
`Cache-Control: private, no-store` while spikes are disabled.

#### Scenario: Spike document served when enabled

- **WHEN** technical spikes are enabled and a browser requests `/template-spikes/memory-box`
- **THEN** the response status is `200`, the body references `runtime.mjs`, and `Cache-Control` is `private, no-store`

#### Scenario: Spike runtime hidden when disabled

- **WHEN** technical spikes are disabled and a browser requests `/template-spikes/runtime.mjs`
- **THEN** the response status is `404`

### Requirement: Live spike verification command

The system SHALL provide `test:spikes`, which requires `TECHNICAL_SPIKE_TOKEN` of at least 24
characters (failing otherwise), targets `LIVE_SPIKE_BASE_URL` (default `http://localhost:3000`),
optionally sends `VERCEL_AUTOMATION_BYPASS_SECRET` as `x-vercel-protection-bypass`, verifies
liveness, readiness, the MongoDB probe and a browser direct upload through the `/studio/spikes` lab,
and always requests cleanup of any spike objects it created. On success it SHALL print a single JSON
line reporting each check as `pass`, including `spikeObjectCleanup`.

#### Scenario: Missing token aborts verification

- **WHEN** `test:spikes` runs without `TECHNICAL_SPIKE_TOKEN`
- **THEN** it fails with `TECHNICAL_SPIKE_TOKEN with at least 24 characters is required.`

#### Scenario: Cleanup runs after a failed check

- **WHEN** an upload was initialized and a later check fails
- **THEN** the command still requests `POST /api/spikes/uploads/cleanup` for the created asset before exiting with a failure
