# Media Upload

## Purpose

Lets the creator of a gift draft upload private images for the draft's `imageList` template fields. The browser uploads bytes directly to private object storage through a short-lived grant, the API verifies the upload and hands it to background processing, and callers can list, read, delete and retry the gift's assets through safe browser DTOs. Processing, the asset lifecycle and cleanup are specified in `media-processing`; the Studio field UI is specified in `studio-image-list-field`; draft access rules are specified in `gift-draft-ownership`; content-type, same-origin and rate-limit guards and the error envelope are specified in `mutation-request-guards`.

## Requirements

### Requirement: Gift-bound asset authorization

The system SHALL resolve the caller's accessors from the signed-in user session and the anonymous draft cookie, and SHALL authorize every media operation against the gift identified by `giftPublicId` using the gift draft access rules. An asset SHALL be visible to an operation only when the gift is accessible to the caller, the asset belongs to that gift, and the asset's status is not `deleted`. An unauthorized gift, a missing asset, an asset of another gift, a `deleted` asset, or a malformed asset ID or `giftPublicId` on the single-asset routes SHALL all respond `404` with code `NOT_FOUND`, so the response does not reveal whether the asset exists. A new asset SHALL inherit the gift's owner: the user ID for a user-owned gift or the anonymous draft ID for an anonymous gift, never both.

#### Scenario: Asset of another gift

- **WHEN** a caller who can access gift A requests `GET /api/media/assets/{assetId}?giftPublicId=A` for an asset that belongs to gift B
- **THEN** the response is `404` with code `NOT_FOUND`

#### Scenario: Caller without access to the gift

- **WHEN** a caller with neither a matching session nor a matching anonymous draft cookie calls any media route for a gift
- **THEN** the response is `404` with code `NOT_FOUND`

#### Scenario: Anonymous draft upload

- **WHEN** a caller holding a valid anonymous draft cookie initializes an upload for their anonymous draft
- **THEN** the created asset is owned by that anonymous draft ID and has no user owner

### Requirement: Upload initialization

The system SHALL accept `POST /api/media/uploads/init` with a strict JSON body containing only `contentType`, `fieldId` (1 to 80 characters), `fileName` (1 to 180 characters), `giftPublicId` and `sizeBytes` (a positive integer no greater than 10485760 bytes). `contentType` MUST be one of `image/jpeg`, `image/png` or `image/webp`; any other value, including `image/svg+xml`, SHALL be rejected with `400` and code `VALIDATION_ERROR` before any asset or grant is created. Upload initialization SHALL only be allowed for a gift whose status is `draft`; otherwise the response SHALL be `404` with code `NOT_FOUND`. The `fieldId` MUST name a field of type `imageList` in the gift's bound template version; otherwise the response SHALL be `422` with code `VALIDATION_ERROR`. Initialization requests SHALL be rate limited under the `media-upload` scope to 30 requests per 600-second window per subject (the signed-in user, else the anonymous draft, else the client IP), responding `429` with code `RATE_LIMITED` and a `Retry-After` header when exceeded.

#### Scenario: SVG upload rejected

- **WHEN** a caller initializes an upload with `contentType` `image/svg+xml`
- **THEN** the response is `400` with code `VALIDATION_ERROR`
- **AND** no asset is created

#### Scenario: Oversized declaration rejected

- **WHEN** a caller initializes an upload with `sizeBytes` 10485761
- **THEN** the response is `400` with code `VALIDATION_ERROR`

#### Scenario: Field that does not accept images

- **WHEN** a caller initializes an upload for a `fieldId` that is not an `imageList` field of the gift's template version
- **THEN** the response is `422` with code `VALIDATION_ERROR`

#### Scenario: Gift that is not a draft

- **WHEN** a caller initializes an upload for an accessible gift whose status is not `draft`
- **THEN** the response is `404` with code `NOT_FOUND`

### Requirement: Short-lived scoped upload grant

On successful initialization the system SHALL create an asset in status `initiated` and respond `201` with `data` containing `assetId` (a new UUID), `method` `PUT`, a presigned `url`, `headers` (containing `content-type` set to the declared content type) and `expiresAt`. The grant SHALL expire 600 seconds after issuance and SHALL be scoped to a single private storage pathname unique to the new asset, to exactly the declared content type, and to a maximum size equal to the declared `sizeBytes`; it SHALL NOT allow overwriting an existing object. If the storage provider cannot issue the grant, the system SHALL release the asset's quota reservation and respond `500` with code `INTERNAL_ERROR`.

#### Scenario: Grant issued

- **WHEN** an authorized caller initializes an `image/jpeg` upload of 4096 bytes for an `imageList` field with free quota
- **THEN** the response is `201` with `method` `PUT`, `headers` `{ "content-type": "image/jpeg" }` and an `expiresAt` 600 seconds in the future
- **AND** the asset is stored with status `initiated`

#### Scenario: Grant issuance fails

- **WHEN** the storage provider fails to create the presigned upload
- **THEN** the response is `500` with code `INTERNAL_ERROR`
- **AND** the reserved asset no longer counts against the gift or field quota

### Requirement: Atomic per-gift and per-field quotas

The system SHALL limit each gift to 30 active assets and each `imageList` field to the field's `maxItems` active assets, where an active asset is any asset whose status is not `deleted` (including `failed` and `deleting` assets). Quota checks and slot reservation SHALL be atomic so that concurrent initialization requests cannot exceed either limit. A request that would exceed either limit SHALL respond `429` with code `RATE_LIMITED`. Deleting an asset SHALL free its slots once it reaches `deleted`.

#### Scenario: Field quota reached

- **WHEN** an `imageList` field with `maxItems` 3 already has 3 non-deleted assets and the caller initializes another upload for it
- **THEN** the response is `429` with code `RATE_LIMITED`
- **AND** no asset is created

#### Scenario: Concurrent uploads at the limit

- **WHEN** two initialization requests for the same field race for its last free slot
- **THEN** at most one of them creates an asset and the other responds `429` with code `RATE_LIMITED`

### Requirement: Upload completion

The system SHALL accept `POST /api/media/uploads/complete` with a strict JSON body containing only `assetId` and `giftPublicId`. For an `initiated` asset, the system SHALL read the stored object's metadata and SHALL accept the upload only when its size equals the declared `sizeBytes` and its content type equals the declared content type (compared case-insensitively). On acceptance the asset SHALL move to `uploaded` together with enqueueing its processing job in one atomic step, background processing SHALL be dispatched, and the response SHALL be `202` with the asset DTO. Completion SHALL be idempotent: for an asset already in `uploaded`, `processing` or `ready` it SHALL respond `202` with the current DTO without enqueueing again. A failure to dispatch background processing SHALL NOT change the `202` response, because the enqueued job remains durable.

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

#### Scenario: Completion after failure or deletion

- **WHEN** completion is requested for an asset in `failed` or `deleting`, or the asset leaves `initiated` concurrently
- **THEN** the response is `409` with code `CONFLICT`

### Requirement: Asset listing and reading with safe DTOs

The system SHALL list a gift's assets through `GET /api/media/assets?giftPublicId=...` and read one asset through `GET /api/media/assets/{assetId}?giftPublicId=...`. The list SHALL contain every non-`deleted` asset of the gift in creation order, wrapped as `data.assets`; a missing or malformed `giftPublicId` on the list route SHALL respond `400` with code `VALIDATION_ERROR`. Each asset DTO SHALL contain exactly `assetId`, `derivatives`, `failureCode`, `fieldId`, `placeholderDataUrl` and `status`, and MUST NOT expose storage keys or pathnames, owner identifiers, checksums or attempt counts. `derivatives` SHALL be non-empty only when `status` is `ready`, each entry containing only `width`, `height` and a signed private download `url` valid for 300 seconds. When the list is requested with `includeDownloadUrls=false`, the system SHALL return every DTO with an empty `derivatives` array and SHALL NOT sign any URL.

#### Scenario: Ready asset DTO

- **WHEN** an authorized caller reads a `ready` asset
- **THEN** the response is `200` and each derivative carries `width`, `height` and a signed `url` that expires after 300 seconds
- **AND** the DTO contains no storage key

#### Scenario: Status-only listing

- **WHEN** the list is requested with `includeDownloadUrls=false`
- **THEN** every returned asset has an empty `derivatives` array and no download URL is issued

#### Scenario: Missing gift identifier on list

- **WHEN** `GET /api/media/assets` is called without `giftPublicId`
- **THEN** the response is `400` with code `VALIDATION_ERROR`

### Requirement: Asset deletion

The system SHALL delete an asset through `DELETE /api/media/assets/{assetId}` with a strict JSON body containing only `giftPublicId`. Deletion SHALL be allowed from any non-`deleted` status: the asset SHALL first move to `deleting`, then its source object and every derivative object SHALL be removed from storage, and only after all removals succeed SHALL the asset move to `deleted` and the response be `200` with `data` `{ assetId, deleted: true }`. If any storage removal fails, the response SHALL be `500` with code `INTERNAL_ERROR` and the asset SHALL remain `deleting` so that the delete can be repeated or finished by background cleanup. If the final transition to `deleted` loses a race, the response SHALL be `409` with code `CONFLICT`.

#### Scenario: Delete a ready asset

- **WHEN** an authorized caller deletes a `ready` asset
- **THEN** the source and all derivative objects are removed and the asset becomes `deleted`
- **AND** the response is `200` with `deleted` `true`

#### Scenario: Storage cleanup fails

- **WHEN** removing one of the asset's objects fails
- **THEN** the response is `500` with code `INTERNAL_ERROR`
- **AND** the asset remains `deleting`

### Requirement: Manual processing retry

The system SHALL accept `POST /api/media/assets/{assetId}/retry` with a strict JSON body containing only `giftPublicId`. A retry SHALL be allowed only for an asset whose status is `failed` and whose `failureCode` is `PROCESSING_FAILED`; any other status or failure code SHALL respond `409` with code `CONFLICT`. An asset that has already used 3 processing attempts SHALL respond `409` with code `CONFLICT` (retry limit reached). An allowed retry SHALL move the asset back to `uploaded`, re-queue its processing job, dispatch background processing, and respond `200` with the asset DTO.

#### Scenario: Transient failure retried

- **WHEN** a caller retries a `failed` asset with `failureCode` `PROCESSING_FAILED` and fewer than 3 attempts
- **THEN** the response is `200` with `status` `uploaded`

#### Scenario: Terminal failure cannot be retried

- **WHEN** a caller retries a `failed` asset with `failureCode` `UPLOAD_INVALID`
- **THEN** the response is `409` with code `CONFLICT`

#### Scenario: Retry budget exhausted

- **WHEN** a caller retries a `failed` asset that has 3 attempts
- **THEN** the response is `409` with code `CONFLICT`

### Requirement: Gift content references assets by ID only

Gift content SHALL reference uploaded images only by asset UUID inside `imageList` field values and MUST NOT contain storage URLs, keys or image bytes. An asset SHALL be referenceable from a draft save only when it belongs to the same gift and the same field and its status is `initiated`, `uploaded`, `processing`, `ready` or `failed`; assets in `deleting` or `deleted` SHALL NOT be referenceable. The save-time validation, uniqueness and item-count rules are specified in `gift-drafts`.

#### Scenario: Deleted asset referenced

- **WHEN** a draft save references an asset of the same gift and field whose status is `deleted`
- **THEN** the save is rejected with `400` and code `VALIDATION_ERROR`

#### Scenario: Failed asset referenced

- **WHEN** a draft save references an asset of the same gift and field whose status is `failed`
- **THEN** the reference is accepted by media validation
