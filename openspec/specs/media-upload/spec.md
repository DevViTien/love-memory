# Media Upload

## Purpose

Lets the creator of a gift draft upload private images for the draft's `imageList` template fields. The browser uploads bytes directly to private object storage through a short-lived grant, the API verifies the upload and hands it to background processing, and callers can list, read, delete and retry the gift's assets through safe browser DTOs. Processing, the asset lifecycle and cleanup are specified in `media-processing`; the Studio field UI is specified in `studio-image-list-field`; draft access rules are specified in `gift-draft-ownership`; content-type, same-origin and rate-limit guards and the error envelope are specified in `mutation-request-guards`.

## Requirements

### Requirement: Gift-bound asset authorization

The system SHALL resolve the caller's accessors from the signed-in user session and the anonymous draft cookie, and SHALL authorize every media operation against the gift identified by `giftPublicId` using the gift draft access rules. Every media operation SHALL require the gift's status to be `draft` or `published`: upload initialization and completion, listing, reading, deletion and retry. For a `published` gift these operations act on its working copy (`gift-publishing` "Editing a published gift"), and only its signed-in owner can reach them. An asset SHALL be visible to an operation only when the gift is accessible to the caller and is a `draft` or `published`, the asset belongs to that gift, the asset's status is not `deleted`, and the asset is not detached from the working copy (see "Asset deletion"). An unauthorized gift, a gift in any other status, a missing asset, an asset of another gift, a `deleted` asset, a detached asset, or a malformed asset ID or `giftPublicId` on the single-asset routes SHALL all respond `404` with code `NOT_FOUND`, so the response does not reveal whether the asset exists. Signed download URLs for recipients SHALL be issued only as specified in `public-gift-viewer`. A new asset SHALL inherit the gift's owner: the user ID for a user-owned gift or the anonymous draft ID for an anonymous gift, never both.

#### Scenario: Asset of another gift

- **WHEN** a caller who can access gift A requests `GET /api/media/assets/{assetId}?giftPublicId=A` for an asset that belongs to gift B
- **THEN** the response is `404` with code `NOT_FOUND`

#### Scenario: Caller without access to the gift

- **WHEN** a caller with neither a matching session nor a matching anonymous draft cookie calls any media route for a gift
- **THEN** the response is `404` with code `NOT_FOUND`

#### Scenario: Anonymous draft upload

- **WHEN** a caller holding a valid anonymous draft cookie initializes an upload for their anonymous draft
- **THEN** the created asset is owned by that anonymous draft ID and has no user owner

#### Scenario: Assets of a published gift

- **WHEN** the owner of a published gift lists its assets, reads one or uploads a new photo
- **THEN** each request succeeds as for a draft, and the listing contains the working copy's assets

#### Scenario: Another creator and a published gift

- **WHEN** a signed-in creator who is not the owner calls any media route for a published gift
- **THEN** the response is `404` with code `NOT_FOUND`, and no download URL is signed

#### Scenario: Gift in another status

- **WHEN** the owner calls any media route for a gift whose status is neither `draft` nor `published`
- **THEN** each response is `404` with code `NOT_FOUND`, no download URL is signed, and every asset keeps its status

### Requirement: Upload initialization

The system SHALL accept `POST /api/media/uploads/init` with a strict JSON body containing only `contentType`, `fieldId` (1 to 80 characters), `fileName` (1 to 180 characters), `giftPublicId` and `sizeBytes` (a positive integer no greater than 10485760 bytes). `contentType` MUST be one of `image/jpeg`, `image/png` or `image/webp`; any other value, including `image/svg+xml`, SHALL be rejected with `400` and code `VALIDATION_ERROR` before any asset or grant is created. Upload initialization SHALL only be allowed for a gift whose status is `draft` or `published`; otherwise the response SHALL be `404` with code `NOT_FOUND`. The `fieldId` MUST name a field of type `imageList` or `captionedImageList` in the gift's bound template version; otherwise the response SHALL be `422` with code `VALIDATION_ERROR`. Initialization requests SHALL be rate limited under the `media-upload` scope to 30 requests per 600-second window per subject (the signed-in user, else the anonymous draft, else the client IP), responding `429` with code `RATE_LIMITED` and a `Retry-After` header when exceeded.

#### Scenario: SVG upload rejected

- **WHEN** a caller initializes an upload with `contentType` `image/svg+xml`
- **THEN** the response is `400` with code `VALIDATION_ERROR`
- **AND** no asset is created

#### Scenario: Oversized declaration rejected

- **WHEN** a caller initializes an upload with `sizeBytes` 10485761
- **THEN** the response is `400` with code `VALIDATION_ERROR`

#### Scenario: Field that does not accept images

- **WHEN** a caller initializes an upload for a `fieldId` that is neither an `imageList` nor a `captionedImageList` field of the gift's template version
- **THEN** the response is `422` with code `VALIDATION_ERROR`

#### Scenario: Captioned image field accepts uploads

- **WHEN** an authorized caller initializes an `image/jpeg` upload for a `captionedImageList` field with free quota
- **THEN** the response is `201` and the new asset is bound to that field

#### Scenario: Gift that is not a draft

- **WHEN** a caller initializes an `image/jpeg` upload, for a field with free quota, of an accessible published gift, and of an accessible gift whose status is neither `draft` nor `published`
- **THEN** the published gift's request is answered `201`, and the other is answered `404` with code `NOT_FOUND`

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

The system SHALL limit each gift to 30 active assets and each `imageList` or `captionedImageList` field to the field's `maxItems` active assets, where an active asset is any asset whose status is not `deleted` (including `failed` and `deleting` assets) and that is not detached from the working copy. Quota checks and slot reservation SHALL be atomic so that concurrent initialization requests cannot exceed either limit. A request that would exceed either limit SHALL respond `429` with code `RATE_LIMITED`. Deleting an asset SHALL free its slots once it reaches `deleted`, and detaching it SHALL free its slots at once.

#### Scenario: Field quota reached

- **WHEN** an `imageList` or `captionedImageList` field with `maxItems` 3 already has 3 non-deleted assets and the caller initializes another upload for it
- **THEN** the response is `429` with code `RATE_LIMITED`
- **AND** no asset is created

#### Scenario: Concurrent uploads at the limit

- **WHEN** two initialization requests for the same field race for its last free slot
- **THEN** at most one of them creates an asset and the other responds `429` with code `RATE_LIMITED`

#### Scenario: Replacing a published photo in a full field

- **WHEN** a published gift's `memories` field holds 8 photos with `maxItems` 8, the owner deletes one that the current publication references, and initializes a new upload for `memories`
- **THEN** the deletion detaches the photo and the upload answers `201`

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

### Requirement: Asset listing and reading with safe DTOs

The system SHALL list a gift's assets through `GET /api/media/assets?giftPublicId=...` and read one asset through `GET /api/media/assets/{assetId}?giftPublicId=...`. The list SHALL contain every non-`deleted` asset of the gift that is not detached from the working copy, in creation order, wrapped as `data.assets`; a missing or malformed `giftPublicId` on the list route SHALL respond `400` with code `VALIDATION_ERROR`. Each asset DTO SHALL contain exactly `assetId`, `derivatives`, `failureCode`, `fieldId`, `placeholderDataUrl` and `status`, and MUST NOT expose storage keys or pathnames, owner identifiers, checksums or attempt counts. `derivatives` SHALL be non-empty only when `status` is `ready`, each entry containing only `width`, `height` and a signed private download `url` valid for 300 seconds. When the list is requested with `includeDownloadUrls=false`, the system SHALL return every DTO with an empty `derivatives` array and SHALL NOT sign any URL.

#### Scenario: Ready asset DTO

- **WHEN** an authorized caller reads a `ready` asset
- **THEN** the response is `200` and each derivative carries `width`, `height` and a signed `url` that expires after 300 seconds
- **AND** the DTO contains no storage key

#### Scenario: Status-only listing

- **WHEN** the list is requested with `includeDownloadUrls=false`
- **THEN** every returned asset has an empty `derivatives` array and no download URL is issued

#### Scenario: Detached asset not listed

- **WHEN** the owner lists the assets of a published gift after one photo was detached
- **THEN** the list does not contain that photo, and reading it answers `404` with code `NOT_FOUND`

#### Scenario: Missing gift identifier on list

- **WHEN** `GET /api/media/assets` is called without `giftPublicId`
- **THEN** the response is `400` with code `VALIDATION_ERROR`

### Requirement: Asset deletion

The system SHALL delete an asset through `DELETE /api/media/assets/{assetId}` with a strict JSON body containing only `giftPublicId`. Deletion SHALL be allowed from any non-`deleted` status while the gift is a `draft` or `published`, unless the gift's current publication references the asset: the asset SHALL first move to `deleting`, then its source object and every derivative object SHALL be removed from storage, and only after all removals succeed SHALL the asset move to `deleted` and the response be `200` with `data` `{ assetId, deleted: true }`.

When the gift's current publication references the asset, the deletion SHALL detach it from the working copy instead, because recipients still need it. The asset keeps its status and every storage object, its quota slots are released, it is excluded from every media operation, listing and save reference from then on, and the response SHALL be `200` with `data` `{ assetId, deleted: false }`. A detached asset SHALL stay available to recipients through `public-gift-viewer` for as long as a served publication references it. Detaching SHALL NOT remove any storage object.

The choice between deleting and detaching, and the move to `deleting`, SHALL be atomic with the gift's status and current publication, so that it can never interleave with a publish of that gift. Either the publish sees the asset leave `ready` and publishes nothing, or the deletion sees the new publication and detaches the asset if that publication references it. A deletion refused because the gift's status is neither `draft` nor `published` SHALL respond `404` with code `NOT_FOUND` without changing the asset, never `409`, whether the gift left those statuses before the request or during it. If any storage removal fails, the response SHALL be `500` with code `INTERNAL_ERROR` and the asset SHALL remain `deleting` so that the delete can be repeated or finished by background cleanup. If the final transition to `deleted` loses a race, the response SHALL be `409` with code `CONFLICT`.

#### Scenario: Delete a ready asset

- **WHEN** an authorized caller deletes a `ready` asset that no current publication references
- **THEN** the source and all derivative objects are removed and the asset becomes `deleted`
- **AND** the response is `200` with `deleted` `true`

#### Scenario: Photo of the current publication detached

- **WHEN** the owner of a published gift deletes a photo that the gift's current publication references
- **THEN** the response is `200` with `deleted` `false`, no storage object is removed, the photo stays `ready`, and recipients still receive it

#### Scenario: Photo added after publishing

- **WHEN** the owner of a published gift deletes a photo uploaded after the last publication
- **THEN** the photo is deleted as for a draft, and the response is `200` with `deleted` `true`

#### Scenario: Storage cleanup fails

- **WHEN** removing one of the asset's objects fails
- **THEN** the response is `500` with code `INTERNAL_ERROR`
- **AND** the asset remains `deleting`

#### Scenario: Deletion races a publish

- **WHEN** the owner deletes a photo while a publish that references it is committing
- **THEN** either the publish fails and the photo is deleted, or the publish succeeds and the deletion detaches the photo, which stays `ready`; never a current publication with a deleted photo

#### Scenario: Gift published before the delete reaches the asset

- **WHEN** the delete request passes authorization while the gift is a draft, and the gift is published with that photo before the asset moves to `deleting`
- **THEN** the response is `200` with `deleted` `false`, and the asset stays `ready`

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

Gift content SHALL reference uploaded images only by asset UUID, either as the items of `imageList` field values or as the `assetId` of `captionedImageList` items, and MUST NOT contain storage URLs, keys or image bytes. An asset SHALL be referenceable from a draft save only when it belongs to the same gift and the same field, its status is `initiated`, `uploaded`, `processing`, `ready` or `failed`, and it is not detached from the working copy; assets in `deleting` or `deleted`, and detached assets, SHALL NOT be referenceable. The save-time validation, uniqueness and item-count rules are specified in `gift-drafts`.

#### Scenario: Deleted asset referenced

- **WHEN** a draft save references an asset of the same gift and field whose status is `deleted`
- **THEN** the save is rejected with `400` and code `VALIDATION_ERROR`

#### Scenario: Detached asset referenced

- **WHEN** a save of a published gift's working copy references a detached asset of the same gift and field
- **THEN** the save is rejected with `400` and code `VALIDATION_ERROR`

#### Scenario: Failed asset referenced

- **WHEN** a draft save references an asset of the same gift and field whose status is `failed`
- **THEN** the reference is accepted by media validation

#### Scenario: Captioned item with a storage URL

- **WHEN** a draft save sets a `captionedImageList` item to `{ "assetId": "<uuid>", "url": "https://store.example/photo.jpg" }`
- **THEN** the save is rejected with `400` and code `VALIDATION_ERROR`

### Requirement: Cleanup of detached assets

The system SHALL delete the assets that no served publication needs, through the generic job
`gift.assets.cleanup.v1` (`background-jobs`), whose payload is `{ giftId }` and whose deduplication
key is `gift.assets.cleanup.v1:{giftId}:{revision}`.

**Which assets.** For its gift the job SHALL select every asset that meets all of these:

- it belongs to the gift;
- it is detached from the working copy (`detachedAt` set);
- it is `ready`;
- its id is not in the `assetIds` of the gift's current publication (the one whose revision equals
  the gift's `publishedRevision`).

**Deleting each one.** For each selected asset the job SHALL do what "Asset deletion" does for a
deletable asset:

1. move it to `deleting`, conditionally on it still being detached and `ready`;
2. remove its source object and every derivative object from storage;
3. only after all removals succeed, mark it `deleted`.

An asset that is not detached, or that the current publication references, MUST NOT be changed.

**Failures and no-ops.**

- If a storage removal fails, the job SHALL still handle the other selected assets, and then fail
  with the retryable code `STORAGE_DELETE_FAILED`. The failed asset stays `deleting` with an expiry
  60 seconds later, so the media expired-asset cleanup (`media-processing`) finishes it.
- A gift that no longer exists, or whose status is not `published`, SHALL complete the job without
  changing anything.
- A published gift whose current publication cannot be read SHALL fail the job with the retryable
  code `PUBLICATION_UNREADABLE` and change nothing, because then nothing proves a photo unused.
- Running the job again SHALL find nothing left to do.

Because a detached asset can never again be referenced by a save of the working copy, no later
publication can need an asset this job deletes.

#### Scenario: Replaced photo deleted after the update

- **WHEN** the owner of a published gift deletes a photo of its current publication (it is
  detached), adds another, and publishes the update
- **THEN** the cleanup job for that revision deletes the detached photo's objects, and the photo
  becomes `deleted`
- **AND** recipients receive the new publication, which does not reference it

#### Scenario: Photo still in the current publication

- **WHEN** a cleanup job runs for a gift whose detached photo is still referenced by the current
  publication, because no update has been published yet
- **THEN** the photo stays `ready` with all its objects

#### Scenario: Storage removal fails

- **WHEN** removing one object of a selected photo fails
- **THEN** the job's other photos are still deleted, the job fails with `STORAGE_DELETE_FAILED` and
  is retried, and the photo is `deleting` until the expired-asset cleanup removes the rest

#### Scenario: Gift gone

- **WHEN** a cleanup job runs for a gift that no longer exists
- **THEN** the job completes and changes nothing
