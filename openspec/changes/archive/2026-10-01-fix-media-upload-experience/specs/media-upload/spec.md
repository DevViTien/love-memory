## MODIFIED Requirements

### Requirement: Upload completion

The system SHALL accept `POST /api/media/uploads/complete` with a strict JSON body containing only `assetId` and `giftPublicId`. For an `initiated` asset, the system SHALL read the stored object's metadata and SHALL accept the upload only when its size equals the declared `sizeBytes` and its content type equals the declared content type (compared case-insensitively). On acceptance the asset SHALL move to `uploaded` together with enqueueing its processing job in one atomic step, background processing SHALL be dispatched, and the response SHALL be `202` with the asset DTO. Completion SHALL be idempotent: for an asset already in `uploaded`, `processing` or `ready` it SHALL respond `202` with the current DTO without enqueueing again. This SHALL also hold when the asset leaves `initiated` for `uploaded`, `processing` or `ready` through a concurrent completion of the same asset while the request is running (for example a client retry after its first request timed out): the request that loses the race SHALL respond `202` with the current DTO and SHALL NOT enqueue a second job. A failure to dispatch background processing SHALL NOT change the `202` response, because the enqueued job remains durable.

#### Scenario: Verified completion

- **WHEN** the stored object matches the declared size and content type
- **THEN** the response is `202` with `status` `uploaded`
- **AND** exactly one processing job is enqueued for the asset

#### Scenario: Object missing

- **WHEN** completion is requested but no object exists at the asset's storage pathname
- **THEN** the asset becomes `failed` with `failureCode` `OBJECT_MISSING`
- **AND** the response is `422` with code `VALIDATION_ERROR`

#### Scenario: Declared metadata mismatch

- **WHEN** the stored object's size or content type differs from the declaration
- **THEN** the asset becomes `failed` with `failureCode` `UPLOAD_INVALID`, the stored object is deleted on a best-effort basis
- **AND** the response is `422` with code `VALIDATION_ERROR`

#### Scenario: Transient storage error

- **WHEN** reading the object metadata fails for a reason other than the object being missing
- **THEN** the response is `500` with code `INTERNAL_ERROR`
- **AND** the asset stays `initiated` so completion can be requested again

#### Scenario: Concurrent duplicate completion

- **WHEN** two completion requests for the same `initiated` asset run at the same time and the other request moves the asset to `uploaded` first
- **THEN** both responses are `202` with the asset DTO
- **AND** exactly one processing job exists for the asset

#### Scenario: Completion after failure or deletion

- **WHEN** completion is requested for an asset in `failed` or `deleting`, or the asset leaves `initiated` concurrently for `failed` or `deleting`
- **THEN** the response is `409` with code `CONFLICT`
