## MODIFIED Requirements

### Requirement: Content validation against template fields

`PATCH /api/gifts/{publicId}` SHALL accept a strict JSON body containing only `content` (an object) and `expectedRevision` (a non-negative integer). The system SHALL validate `content` against the fields of the draft's bound template version, which may have status `published` or `retired`. Validation rules:

- Every field is optional in a draft.
- Keys that the template does not declare are rejected.
- `shortText` and `longText` values are trimmed and must be 1 to `maxLength` characters.
- `date` values must be ISO calendar dates.
- `theme` values must be one of the field's declared options.
- `audio` values must be the `id` of a track in the licensed audio catalog whose `status` is `active`. An unknown id or the id of a `withdrawn` track is rejected, including when the draft already stored it.
- `imageList` values must be arrays of unique UUIDs with at most `maxItems` entries. A draft is allowed to hold fewer than `minItems` entries, so that images can be saved one at a time; `minItems` is enforced only by full payload validation as specified in `template-manifest-contract`. Each referenced asset must exist, belong to this gift and field, and have a status of `initiated`, `uploaded`, `processing`, `ready`, or `failed`.
- `captionedImageList` values must be arrays of at most `maxItems` items of the form `{ assetId, caption? }` with unique `assetId` UUIDs; as for `imageList`, a draft is allowed to hold fewer than `minItems` items. Captions are trimmed and must then be 1 to `captionMaxLength` characters. Each referenced asset must satisfy the same existence, ownership, field and status rules as for `imageList`.

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

### Requirement: Studio draft creation and editing flow

The studio page `/studio/new?template={templateId}` SHALL offer draft creation for a published template's current version. It SHALL generate one UUID `Idempotency-Key` per page instance and reuse that key on retries. After a successful creation it SHALL navigate to `/studio/{publicId}`. The editor SHALL present the template fields in steps, with the inputs, counters and validation specified in `studio-editor`. It SHALL persist changes through the autosave specified in `studio-autosave`, which sends the last known `revision` as `expectedRevision` and keeps unsaved on-screen content when a save fails. The editor SHALL NOT show revision numbers such as `Revision 1` in its normal state; a revision number appears only in the conflict banner. `imageList` and `captionedImageList` fields SHALL be rendered by the Studio image field specified in `studio-image-list-field`. An `audio` field SHALL be rendered as a single choice between `Không dùng nhạc`, which removes the field from the content, and each selectable track of the licensed audio catalog, labelled with its title and artist. When no track is selectable, the audio field SHALL state `Chưa có nhạc để chọn` and leave the field empty. A stored track id that is not selectable SHALL be shown as unavailable, with an inline field error, until the creator chooses again, and the Studio SHALL NOT send content that still carries it.

#### Scenario: Create then edit

- **WHEN** a visitor starts a draft from `/studio/new?template=memory-box`, types valid text into one field and pauses
- **THEN** the browser navigates to `/studio/{publicId}`, the save status shows `Đã lưu` after the autosave, and reloading the page shows the typed text

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
