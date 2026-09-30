# Gift Drafts

## Purpose

Lets creators create, read, and edit gift drafts. Each draft is bound to one immutable template version, its content is validated against that version's fields, concurrent saves are protected by revision numbers, and every saved revision is kept as history. Who may access a draft is specified in `gift-draft-ownership`; request guards, rate limits, and the error envelope are specified in `mutation-request-guards`.

## Requirements

### Requirement: Create a draft bound to a published template version

The system SHALL create a draft through `POST /api/gifts` with a strict JSON body containing only `templateId` (a slug of 3 to 80 characters) and `templateVersion` (a semantic version). A draft SHALL be created only when that exact template version has status `published`. Otherwise the system SHALL respond `404` with code `NOT_FOUND`. A new draft SHALL have status `draft`, revision `0`, empty content `{}`, and a newly generated URL-safe `publicId`. It SHALL stay bound to the template ID and version it was created with. A successful creation SHALL respond `201` with the draft DTO.

#### Scenario: Create from a published version

- **WHEN** a client posts `{ "templateId": "memory-box", "templateVersion": "1.0.0" }` and that version is published
- **THEN** the response is `201` with `data.gift.status` `draft`, `data.gift.revision` `0`, and `data.gift.content` `{}`

#### Scenario: Unknown or unpublished version

- **WHEN** the requested template version does not exist or is not `published`
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

The system SHALL return an authorized draft through `GET /api/gifts/{publicId}` with status `200` and the draft DTO. The system SHALL respond `404` with code `NOT_FOUND` in each of these cases: the `publicId` is not 16 to 64 characters from `[A-Za-z0-9_-]`, the requester presents no draft credentials, the requester is not authorized for the draft, or the gift is no longer in status `draft`. The studio editor page `/studio/{publicId}` SHALL load the draft through the same authorization rules and SHALL render the not-found page in the same cases.

#### Scenario: Owner reads a draft

- **WHEN** an authorized requester calls `GET /api/gifts/{publicId}` for an existing draft
- **THEN** the response is `200` with `data.gift` containing that draft

#### Scenario: Malformed public ID

- **WHEN** `GET /api/gifts/{publicId}` is called with a `publicId` shorter than 16 characters or containing unsupported characters
- **THEN** the response is `404` with code `NOT_FOUND`

### Requirement: Content validation against template fields

`PATCH /api/gifts/{publicId}` SHALL accept a strict JSON body containing only `content` (an object) and `expectedRevision` (a non-negative integer). The system SHALL validate `content` against the fields of the draft's bound template version, which may have status `published` or `retired`. Validation rules:

- Every field is optional in a draft.
- Keys that the template does not declare are rejected.
- `shortText` and `longText` values are trimmed and must be 1 to `maxLength` characters.
- `date` values must be ISO calendar dates.
- `theme` values must be one of the field's declared options.
- `audio` values must be strings of 1 to 160 characters.
- `imageList` values must be arrays of unique UUIDs with between `minItems` and `maxItems` entries. Each referenced asset must exist, belong to this gift and field, and have a status of `initiated`, `uploaded`, `processing`, `ready`, or `failed`.

Invalid content SHALL be rejected with `400`, code `VALIDATION_ERROR`, and per-field `fieldErrors`, and the stored draft SHALL stay unchanged. If the bound template version is no longer editable, the system SHALL respond `409` with code `CONFLICT`. Content that passes validation SHALL be stored in its normalized form, for example with text trimmed.

#### Scenario: Undeclared field

- **WHEN** a save includes a content key that the bound template version does not declare
- **THEN** the response is `400` with code `VALIDATION_ERROR`, and the draft's revision is unchanged

#### Scenario: Image not owned by this gift field

- **WHEN** an `imageList` value references an asset that does not exist or belongs to a different gift or field
- **THEN** the response is `400` with code `VALIDATION_ERROR` and a `fieldErrors` entry for that field

#### Scenario: Retired template version still editable

- **WHEN** a draft is bound to a template version whose status is `retired`
- **THEN** content saves are still validated against that version and can succeed

### Requirement: Revision numbers and optimistic concurrency

Each successful save SHALL increase the draft's `revision` by exactly 1 and SHALL update `updatedAt`. A save SHALL succeed only if its `expectedRevision` equals the draft's current revision at the moment of writing; the compare-and-increment is atomic. Otherwise the system SHALL respond `409` with code `CONFLICT` and `details` containing `actualRevision` and `expectedRevision`. A stale save MUST NOT overwrite newer content. The studio editor SHALL show the conflicting revision and ask the creator to reload instead of retrying automatically.

#### Scenario: Save with the current revision

- **WHEN** a save with `expectedRevision` `0` is sent to a draft at revision `0`
- **THEN** the response is `200` with `data.gift.revision` `1`

#### Scenario: Stale save

- **WHEN** a save with `expectedRevision` `0` is sent to a draft already at revision `1`
- **THEN** the response is `409` with code `CONFLICT`, `error.details.actualRevision` `1`, and `error.details.expectedRevision` `0`
- **AND** the stored content remains the revision `1` content

### Requirement: Immutable revision history

The system SHALL record a revision snapshot containing the gift ID, revision number, full content snapshot, and timestamp. It records revision `0` when a draft is created and one snapshot for each successful save. Each snapshot SHALL be written in the same database transaction as the draft insert or update, so a draft change and its snapshot either both persist or neither does. Each gift SHALL have at most one snapshot per revision number, and no API SHALL modify or delete snapshots. Claiming a draft SHALL NOT change its revision or record a snapshot.

#### Scenario: Save produces a snapshot atomically

- **WHEN** a save moves a draft from revision `1` to revision `2`
- **THEN** exactly one revision snapshot with revision `2` and the saved content exists for that gift

#### Scenario: Failed save leaves no snapshot

- **WHEN** a save is rejected because of a revision conflict or invalid content
- **THEN** no new revision snapshot is recorded

### Requirement: Draft DTO shape

Draft endpoints SHALL respond with the envelope `{ "data": { "gift": <draft DTO> } }`, where the DTO contains exactly these fields: `content` (the template field values), `createdAt` and `updatedAt` (ISO-8601 date-time strings), `ownerKind` (`anonymous` or `user`), `publicId`, `revision`, `status` (always `draft`), `templateId`, and `templateVersion`. Responses MUST NOT expose raw database documents, internal gift IDs, owner or user IDs, anonymous draft IDs, claim tokens or their hashes, or the access policy.

#### Scenario: Anonymous draft hides its credentials

- **WHEN** an anonymous creator creates a draft
- **THEN** `data.gift.ownerKind` is `anonymous`, and the DTO contains no `claimTokenHash`, anonymous draft ID, or internal `id`

### Requirement: Studio draft creation and editing flow

The studio page `/studio/new?template={templateId}` SHALL offer draft creation for a published template's current version. It SHALL generate one UUID `Idempotency-Key` per page instance and reuse that key on retries. After a successful creation it SHALL navigate to `/studio/{publicId}`. The editor SHALL render one input per template field, send saves with the last known `revision` as `expectedRevision`, show the saved revision number after success, and keep unsaved on-screen content when a save fails because of a network error.

#### Scenario: Create then edit

- **WHEN** a visitor starts a draft from `/studio/new?template=memory-box` and then saves valid content
- **THEN** the browser navigates to `/studio/{publicId}`, and the editor shows `Revision 1` after the save
