## MODIFIED Requirements

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

### Requirement: Draft DTO shape

Draft endpoints SHALL respond with the envelope `{ "data": { "gift": <draft DTO> } }`, where the DTO contains exactly these fields: `content` (the template field values), `createdAt` and `updatedAt` (ISO-8601 date-time strings), `ownerKind` (`anonymous` or `user`), `publicId`, `publication`, `revision`, `status` (`draft` or `published`), `templateId`, and `templateVersion`. `publication` SHALL be `null` for a draft. For a published gift it SHALL hold exactly `shareId`, `sharePath` (`/g/{shareId}`), `publishedAt` (ISO 8601) and `revision` of the gift's current publication, so the gift has unpublished changes exactly when the DTO's `revision` is greater than `publication.revision`. Responses MUST NOT expose raw database documents, internal gift IDs, owner or user IDs, anonymous draft IDs, claim tokens or their hashes, the access policy, or the content of any publication.

#### Scenario: Anonymous draft hides its credentials

- **WHEN** an anonymous creator creates a draft
- **THEN** `data.gift.ownerKind` is `anonymous`, `data.gift.publication` is `null`, and the DTO contains no `claimTokenHash`, anonymous draft ID, or internal `id`

#### Scenario: Published gift summary

- **WHEN** the owner reads a gift published at revision `7` whose working copy is at revision `9`
- **THEN** `data.gift.status` is `published`, `data.gift.revision` is `9`, and `data.gift.publication` holds the share id, `sharePath` `/g/{shareId}`, the publication time and `revision` `7`
