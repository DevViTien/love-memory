# Gift Drafts

## Purpose

Lets creators create, read, and edit gift drafts. Each draft is bound to one immutable template version, its content is validated against that version's fields, concurrent saves are protected by revision numbers, and every saved revision is kept as history. Who may access a draft is specified in `gift-draft-ownership`; request guards, rate limits, and the error envelope are specified in `mutation-request-guards`.

## Requirements

### Requirement: Create a draft bound to a published template version

The system SHALL create a draft through `POST /api/gifts` with a strict JSON body containing only `templateId` (a slug of 3 to 80 characters) and `templateVersion` (a semantic version). A draft SHALL be created only when that exact template version has status `published` and a template artifact is registered for it (`template-artifact-delivery`), so that the gift can be previewed with its template and published. Otherwise the system SHALL respond `404` with code `NOT_FOUND`. A new draft SHALL have status `draft`, revision `0`, empty content `{}`, and a newly generated URL-safe `publicId`. It SHALL stay bound to the template ID and version it was created with. A successful creation SHALL respond `201` with the draft DTO.

#### Scenario: Create from a published version

- **WHEN** a client posts `{ "templateId": "memory-box", "templateVersion": "1.0.0" }` and that version is published with a registered artifact
- **THEN** the response is `201` with `data.gift.status` `draft`, `data.gift.revision` `0`, and `data.gift.content` `{}`

#### Scenario: Unknown or unpublished version

- **WHEN** the requested template version does not exist or is not `published`
- **THEN** the response is `404` with code `NOT_FOUND`, and no draft is created

#### Scenario: Published version without an artifact

- **WHEN** a client posts `{ "templateId": "our-timeline", "templateVersion": "1.0.0" }`, a version that is `published` but has no registered artifact
- **THEN** the response is `404` with code `NOT_FOUND`, and no draft is created

#### Scenario: Unexpected body fields

- **WHEN** the create body contains a property other than `templateId` and `templateVersion`
- **THEN** the response is `400` with code `VALIDATION_ERROR`

### Requirement: Create idempotency

`POST /api/gifts` SHALL require an `Idempotency-Key` header containing a UUID. A missing or malformed key SHALL be rejected with `400`, code `VALIDATION_ERROR`, and a `fieldErrors.idempotencyKey` entry. Each key SHALL be unique within the `gift-create` scope and SHALL be kept for 24 hours after creation. A repeated request with the same key SHALL return `201` with the same draft, as currently stored, only when all of these are true: it comes from the same actor (the same signed-in user ID, or the same anonymous draft identity), it names the same `templateId` and `templateVersion`, and that actor is still authorized for the draft. In every other case the system SHALL respond `409` with code `CONFLICT`, and no new draft SHALL be created. Concurrent requests with the same key SHALL produce at most one draft.

#### Scenario: Lost response is replayed

- **WHEN** the same actor repeats a create request with the same `Idempotency-Key` and the same template ID and version within 24 hours
- **THEN** the response is `201`, and `data.gift.publicId` matches the original draft

#### Scenario: Key reused for a different request

- **WHEN** a create request reuses an `Idempotency-Key` with a different template ID or version, or from a different actor
- **THEN** the response is `409` with code `CONFLICT`

#### Scenario: Missing key

- **WHEN** `POST /api/gifts` is sent without a UUID `Idempotency-Key` header
- **THEN** the response is `400` with code `VALIDATION_ERROR` and `error.fieldErrors.idempotencyKey`

### Requirement: Read a draft

The system SHALL return an authorized gift through `GET /api/gifts/{publicId}` with status `200` and the draft DTO while the gift's status is `draft` or `published`; for a `published` gift the DTO describes its working copy (`gift-publishing` "Editing a published gift"). The system SHALL respond `404` with code `NOT_FOUND` in each of these cases: the `publicId` is not 16 to 64 characters from `[A-Za-z0-9_-]`, the requester presents no draft credentials, the requester is not authorized for the gift, or the gift's status is neither `draft` nor `published`. `PATCH /api/gifts/{publicId}` SHALL accept saves for the same statuses under the same rules and SHALL respond `404` with code `NOT_FOUND` in the same cases. The studio editor page `/studio/{publicId}` SHALL load the gift through the same authorization rules and SHALL render the not-found page in the same cases. For a gift in status `published` that the requester is authorized for, it SHALL render the published panel specified in `gift-publishing` ("Published gift in the Studio") above the editor.

#### Scenario: Owner reads a draft

- **WHEN** an authorized requester calls `GET /api/gifts/{publicId}` for an existing draft
- **THEN** the response is `200` with `data.gift` containing that draft

#### Scenario: Malformed public ID

- **WHEN** `GET /api/gifts/{publicId}` is called with a `publicId` shorter than 16 characters or containing unsupported characters
- **THEN** the response is `404` with code `NOT_FOUND`

#### Scenario: Published gift in the draft API and the Studio

- **WHEN** the owner of a published gift calls `GET /api/gifts/{publicId}` and opens `/studio/{publicId}`
- **THEN** the API responds `200` with `data.gift.status` `published` and its working copy, and the Studio shows the published panel above the editor

#### Scenario: Owner saves a published gift's working copy

- **WHEN** the owner of a gift published at revision `7` sends `PATCH /api/gifts/{publicId}` with valid content and `expectedRevision` `7`
- **THEN** the response is `200` with `data.gift.revision` `8`, and the gift's current publication still has revision `7`

#### Scenario: Gift in another status

- **WHEN** the owner calls `GET` or `PATCH /api/gifts/{publicId}` for a gift whose status is neither `draft` nor `published`
- **THEN** the response is `404` with code `NOT_FOUND`, and the Studio renders the not-found page

### Requirement: Content validation against template fields

`PATCH /api/gifts/{publicId}` SHALL accept a strict JSON body containing only `content` (an object) and `expectedRevision` (a non-negative integer). The system SHALL validate `content` against the fields of the draft's bound template version, which may have status `published` or `retired`. Validation rules:

- Every field is optional in a draft.
- Keys that the template does not declare are rejected.
- `shortText` and `longText` values are trimmed and must be 1 to `maxLength` characters.
- `date` values must be ISO calendar dates.
- `theme` values must be one of the field's declared options.
- `audio` values must be the `id` of a track in the licensed audio catalog whose `status` is `active`. An unknown id or the id of a `withdrawn` track is rejected, including when the draft already stored it.
- `imageList` values must be arrays of unique UUIDs with at most `maxItems` entries. A draft is allowed to hold fewer than `minItems` entries, so that images can be saved one at a time; `minItems` is enforced only by full payload validation as specified in `template-manifest-contract`. Each referenced asset must exist, belong to this gift and field, have a status of `initiated`, `uploaded`, `processing`, `ready`, or `failed`, and not be detached from the working copy (`media-upload` "Asset deletion").
- `captionedImageList` values must be arrays of at most `maxItems` items of the form `{ assetId, caption? }` with unique `assetId` UUIDs; as for `imageList`, a draft is allowed to hold fewer than `minItems` items. Captions are trimmed and must then be 1 to `captionMaxLength` characters. Each referenced asset must satisfy the same existence, ownership, field, status and detachment rules as for `imageList`.

Invalid content SHALL be rejected with `400`, code `VALIDATION_ERROR`, and per-field `fieldErrors`, and the stored draft SHALL stay unchanged. Each `fieldErrors` key SHALL start with the id of the field it concerns, optionally followed by `.`-separated item indexes and keys (for example `memories.0.caption`); an error that concerns no single field, such as an undeclared key, SHALL use the key `content`. If the bound template version is no longer editable, the system SHALL respond `409` with code `CONFLICT`. Content that passes validation SHALL be stored in its normalized form, for example with text and captions trimmed.

#### Scenario: Undeclared field

- **WHEN** a save includes a content key that the bound template version does not declare
- **THEN** the response is `400` with code `VALIDATION_ERROR`, and the draft's revision is unchanged

#### Scenario: Image not owned by this gift field

- **WHEN** an `imageList` value references an asset that does not exist or belongs to a different gift or field
- **THEN** the response is `400` with code `VALIDATION_ERROR` and a `fieldErrors` entry for that field

#### Scenario: Captioned image not owned by this gift field

- **WHEN** a `captionedImageList` item's `assetId` references an asset that does not exist, belongs to a different gift or field, or is `deleting` or `deleted`
- **THEN** the response is `400` with code `VALIDATION_ERROR` and a `fieldErrors` entry for that field, and the draft's revision is unchanged

#### Scenario: Detached photo cannot be re-added

- **WHEN** a save of a published gift's working copy references, in `memories`, an asset that was detached from the working copy
- **THEN** the response is `400` with code `VALIDATION_ERROR` and a `fieldErrors` entry for `memories`, and the revision is unchanged

#### Scenario: Captions stored trimmed

- **WHEN** a save sets a `captionedImageList` field to one item with `caption` `"  Lần đầu gặp nhau  "` and an owned asset
- **THEN** the response is `200` and the stored item's `caption` is `Lần đầu gặp nhau`

#### Scenario: Fewer images than the minimum in a draft

- **WHEN** a save sets a `captionedImageList` field with `minItems` 3 and `maxItems` 8 to one item with an owned asset
- **THEN** the response is `200` and the draft stores that one item

#### Scenario: More images than the maximum

- **WHEN** a save sets a `captionedImageList` field with `maxItems` 8 to nine items with owned assets
- **THEN** the response is `400` with code `VALIDATION_ERROR` and a `fieldErrors` entry whose key starts with that field's id, and the draft's revision is unchanged

#### Scenario: Nested error key names its field

- **WHEN** a save sets the second item of a `captionedImageList` field `memories` to a caption longer than `captionMaxLength`
- **THEN** the response is `400` with code `VALIDATION_ERROR` and `error.fieldErrors` has the key `memories.1.caption`

#### Scenario: Unknown or withdrawn audio track

- **WHEN** a save sets an `audio` field to an id that is not in the licensed audio catalog, or to the id of a `withdrawn` track
- **THEN** the response is `400` with code `VALIDATION_ERROR` and a `fieldErrors` entry for that field, and the draft's revision is unchanged

#### Scenario: Active audio track

- **WHEN** a save sets an `audio` field to the id of an `active` catalog track
- **THEN** the save succeeds and the draft content stores that id

#### Scenario: Retired template version still editable

- **WHEN** a draft is bound to a template version whose status is `retired`
- **THEN** content saves are still validated against that version and can succeed

### Requirement: Revision numbers and optimistic concurrency

Each successful save SHALL increase the draft's `revision` by exactly 1 and SHALL update `updatedAt`, including when the saved content equals the stored content. A save SHALL succeed only if its `expectedRevision` equals the draft's current revision at the moment of writing; the compare-and-increment is atomic. Otherwise the system SHALL respond `409` with code `CONFLICT` and `details` containing `actualRevision` and `expectedRevision`. A stale save MUST NOT overwrite newer content. A `409` `CONFLICT` caused by a template version that is no longer editable SHALL NOT carry `details.actualRevision`, so clients can tell the two apart. The studio editor SHALL stop saving on a revision conflict, show the draft's actual revision, and let the creator choose explicitly between loading the stored draft and saving the on-screen content against the actual revision, as specified in `studio-autosave`. It MUST NOT retry, overwrite or merge automatically.

#### Scenario: Save with the current revision

- **WHEN** a save with `expectedRevision` `0` is sent to a draft at revision `0`
- **THEN** the response is `200` with `data.gift.revision` `1`

#### Scenario: Stale save

- **WHEN** a save with `expectedRevision` `0` is sent to a draft already at revision `1`
- **THEN** the response is `409` with code `CONFLICT`, `error.details.actualRevision` `1`, and `error.details.expectedRevision` `0`
- **AND** the stored content remains the revision `1` content

#### Scenario: Save again against the actual revision

- **WHEN** after that conflict the same content is sent with `expectedRevision` `1`
- **THEN** the response is `200` with `data.gift.revision` `2`, and the stored content is the content of that save

#### Scenario: Non-editable template version is not a revision conflict

- **WHEN** a save is sent to a draft whose bound template version is no longer editable
- **THEN** the response is `409` with code `CONFLICT` and no `error.details.actualRevision`

### Requirement: Immutable revision history

The system SHALL record a revision snapshot containing the gift ID, revision number, full content snapshot, and timestamp. It records revision `0` when a draft is created and one snapshot for each successful save. Each snapshot SHALL be written in the same database transaction as the draft insert or update, so a draft change and its snapshot either both persist or neither does. Each gift SHALL have at most one snapshot per revision number, and no API SHALL modify a snapshot. Because autosave records a snapshot about every 1.5 seconds of editing and each one holds private gift text, the system SHALL keep only the 20 most recent snapshots of a gift: the save that records revision `n` SHALL delete, in the same transaction, the gift's snapshots with a revision lower than `n - 19`. No other API SHALL delete snapshots. Claiming a draft SHALL NOT change its revision or record a snapshot.

#### Scenario: Save produces a snapshot atomically

- **WHEN** a save moves a draft from revision `1` to revision `2`
- **THEN** exactly one revision snapshot with revision `2` and the saved content exists for that gift

#### Scenario: Failed save leaves no snapshot

- **WHEN** a save is rejected because of a revision conflict or invalid content
- **THEN** no new revision snapshot is recorded

#### Scenario: Older snapshots pruned

- **WHEN** a save moves a draft from revision `24` to revision `25`
- **THEN** the gift keeps the snapshots of revisions `6` to `25`, and the snapshots of revisions `0` to `5` no longer exist

#### Scenario: Pruning rolls back with the save

- **WHEN** the save of revision `25` fails inside its transaction
- **THEN** the draft stays at revision `24` and no snapshot is deleted

### Requirement: Draft DTO shape

Draft endpoints SHALL respond with the envelope `{ "data": { "gift": <draft DTO> } }`, where the DTO contains exactly these fields: `content` (the template field values), `createdAt` and `updatedAt` (ISO-8601 date-time strings), `ownerKind` (`anonymous` or `user`), `publicId`, `publication`, `revision`, `status` (`draft` or `published`), `templateId`, and `templateVersion`. `publication` SHALL be `null` for a draft. For a published gift it SHALL hold exactly `shareId`, `sharePath` (`/g/{shareId}`), `publishedAt` (ISO 8601) and `revision` of the gift's current publication, so the gift has unpublished changes exactly when the DTO's `revision` is greater than `publication.revision`. It SHALL also hold the gift's entitlement values that the Studio needs (`gift-plans`): `planId`, `maxPhotos` (an integer, or `null` when only the template limits apply), `watermark` (boolean) and `expiresAt` (ISO 8601). Responses MUST NOT expose raw database documents, internal gift IDs, owner or user IDs, anonymous draft IDs, claim tokens or their hashes, the access policy, the content of any publication, or the entitlement's grant source or price.

#### Scenario: Anonymous draft hides its credentials

- **WHEN** an anonymous creator creates a draft
- **THEN** `data.gift.ownerKind` is `anonymous`, `data.gift.publication` is `null`, and the DTO contains no `claimTokenHash`, anonymous draft ID, or internal `id`

#### Scenario: Published gift summary

- **WHEN** the owner reads a gift published at revision `7` whose working copy is at revision `9`
- **THEN** `data.gift.status` is `published`, `data.gift.revision` is `9`, and `data.gift.publication` holds the share id, `sharePath` `/g/{shareId}`, the publication time and `revision` `7`

#### Scenario: Entitlement in the summary

- **WHEN** the owner reads a gift first published on `free` at `2026-10-08T10:00:00Z`
- **THEN** `data.gift.publication` holds `planId` `free`, `maxPhotos` `3`, `watermark` `true` and `expiresAt` `2026-10-22T10:00:00.000Z`, and no `source`, `priceVnd` or `grantedAt`

### Requirement: Studio draft creation and editing flow

The studio page `/studio/new?template={templateId}` SHALL offer draft creation for a published template's current version when the catalog summary of that version is `available` (`template-catalog`). For a template whose current version is not `available`, the page SHALL show `Mẫu quà này sắp ra mắt.` with a link back to `/templates` and no create action. It SHALL generate one UUID `Idempotency-Key` per page instance and reuse that key on retries. After a successful creation it SHALL navigate to `/studio/{publicId}`. The editor SHALL present the template fields in steps, with the inputs, counters and validation specified in `studio-editor`. It SHALL persist changes through the autosave specified in `studio-autosave`, which sends the last known `revision` as `expectedRevision` and keeps unsaved on-screen content when a save fails. The editor SHALL NOT show revision numbers such as `Revision 1` in its normal state; a revision number appears only in the conflict banner. `imageList` and `captionedImageList` fields SHALL be rendered by the Studio image field specified in `studio-image-list-field`. An `audio` field SHALL be rendered as a single choice between `Không dùng nhạc`, which removes the field from the content, and each selectable track of the licensed audio catalog, labelled with its title and artist. When no track is selectable, the audio field SHALL state `Chưa có nhạc để chọn` and leave the field empty. A stored track id that is not selectable SHALL be shown as unavailable, with an inline field error, until the creator chooses again, and the Studio SHALL NOT send content that still carries it.

#### Scenario: Create then edit

- **WHEN** a visitor starts a draft from `/studio/new?template=memory-box`, types valid text into one field and pauses
- **THEN** the browser navigates to `/studio/{publicId}`, the save status shows `Đã lưu` after the autosave, and reloading the page shows the typed text

#### Scenario: Template that is not yet available

- **WHEN** a visitor opens `/studio/new?template=midnight-wish` and its current version has no registered artifact
- **THEN** the page shows `Mẫu quà này sắp ra mắt.` and a link to `/templates`, and offers no way to create a draft

#### Scenario: Save fails without losing content

- **WHEN** an autosave fails because of a network error
- **THEN** the typed content stays on screen and the save status reports the failure instead of `Đã lưu`

#### Scenario: Choose a music track

- **WHEN** the catalog has an `active` track `acoustic-morning` and the creator selects it in an `audio` field
- **THEN** the next autosave stores `acoustic-morning` for that field

#### Scenario: Empty audio catalog

- **WHEN** the editor renders an `audio` field and the catalog has no selectable track
- **THEN** the field shows `Chưa có nhạc để chọn`, and saving the draft omits that field

#### Scenario: Stored track withdrawn

- **WHEN** a draft stores the id of a track that is now `withdrawn` and the editor opens it
- **THEN** the audio field marks the stored choice as unavailable with an inline field error, and autosave sends nothing until the creator chooses again
- **AND** a save sent directly to the API that still carries it is rejected with a `fieldErrors` entry for that field
