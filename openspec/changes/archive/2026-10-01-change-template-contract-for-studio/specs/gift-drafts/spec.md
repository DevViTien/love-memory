# Spec Delta

## MODIFIED Requirements

### Requirement: Content validation against template fields

`PATCH /api/gifts/{publicId}` SHALL accept a strict JSON body containing only `content` (an object) and `expectedRevision` (a non-negative integer). The system SHALL validate `content` against the fields of the draft's bound template version, which may have status `published` or `retired`. Validation rules:

- Every field is optional in a draft.
- Keys that the template does not declare are rejected.
- `shortText` and `longText` values are trimmed and must be 1 to `maxLength` characters.
- `date` values must be ISO calendar dates.
- `theme` values must be one of the field's declared options.
- `audio` values must be the `id` of a track in the licensed audio catalog whose `status` is `active`. An unknown id or the id of a `withdrawn` track is rejected, including when the draft already stored it.
- `imageList` values must be arrays of unique UUIDs with between `minItems` and `maxItems` entries. Each referenced asset must exist, belong to this gift and field, and have a status of `initiated`, `uploaded`, `processing`, `ready`, or `failed`.
- `captionedImageList` values must be arrays of between `minItems` and `maxItems` items of the form `{ assetId, caption? }` with unique `assetId` UUIDs. Captions are trimmed and must then be 1 to `captionMaxLength` characters. Each referenced asset must satisfy the same existence, ownership, field and status rules as for `imageList`.

Invalid content SHALL be rejected with `400`, code `VALIDATION_ERROR`, and per-field `fieldErrors`, and the stored draft SHALL stay unchanged. If the bound template version is no longer editable, the system SHALL respond `409` with code `CONFLICT`. Content that passes validation SHALL be stored in its normalized form, for example with text and captions trimmed.

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

#### Scenario: Unknown or withdrawn audio track

- **WHEN** a save sets an `audio` field to an id that is not in the licensed audio catalog, or to the id of a `withdrawn` track
- **THEN** the response is `400` with code `VALIDATION_ERROR` and a `fieldErrors` entry for that field, and the draft's revision is unchanged

#### Scenario: Active audio track

- **WHEN** a save sets an `audio` field to the id of an `active` catalog track
- **THEN** the save succeeds and the draft content stores that id

#### Scenario: Retired template version still editable

- **WHEN** a draft is bound to a template version whose status is `retired`
- **THEN** content saves are still validated against that version and can succeed

### Requirement: Studio draft creation and editing flow

The studio page `/studio/new?template={templateId}` SHALL offer draft creation for a published template's current version. It SHALL generate one UUID `Idempotency-Key` per page instance and reuse that key on retries. After a successful creation it SHALL navigate to `/studio/{publicId}`. The editor SHALL render one input per template field, send saves with the last known `revision` as `expectedRevision`, show the saved revision number after success, and keep unsaved on-screen content when a save fails because of a network error. `imageList` and `captionedImageList` fields SHALL be rendered by the Studio image field specified in `studio-image-list-field`. An `audio` field SHALL be rendered as a single choice between `Không dùng nhạc`, which removes the field from the content, and each selectable track of the licensed audio catalog, labelled with its title and artist. When no track is selectable, the audio field SHALL state `Chưa có nhạc để chọn` and leave the field empty. A stored track id that is not selectable SHALL be shown as unavailable until the creator chooses again.

#### Scenario: Create then edit

- **WHEN** a visitor starts a draft from `/studio/new?template=memory-box` and then saves valid content
- **THEN** the browser navigates to `/studio/{publicId}`, and the editor shows `Revision 1` after the save

#### Scenario: Choose a music track

- **WHEN** the catalog has an `active` track `acoustic-morning` and the creator selects it in an `audio` field and saves
- **THEN** the saved draft content stores `acoustic-morning` for that field

#### Scenario: Empty audio catalog

- **WHEN** the editor renders an `audio` field and the catalog has no selectable track
- **THEN** the field shows `Chưa có nhạc để chọn`, and saving the draft omits that field

#### Scenario: Stored track withdrawn

- **WHEN** a draft stores the id of a track that is now `withdrawn` and the editor opens it
- **THEN** the audio field marks the stored choice as unavailable, and a save that still carries it is rejected with a `fieldErrors` entry for that field
