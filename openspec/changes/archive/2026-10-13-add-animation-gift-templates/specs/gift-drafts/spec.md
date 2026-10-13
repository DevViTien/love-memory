## MODIFIED Requirements

### Requirement: Create a draft bound to a published template version

The system SHALL create a draft through `POST /api/gifts` with a strict JSON body containing only `templateId` (a slug of 3 to 80 characters) and `templateVersion` (a semantic version). A draft SHALL be created only when that exact template version has status `published` and a template artifact is registered for it (`template-artifact-delivery`), so that the gift can be previewed with its template and published. Otherwise the system SHALL respond `404` with code `NOT_FOUND`. A new draft SHALL have status `draft`, revision `0`, empty content `{}`, and a newly generated URL-safe `publicId`. It SHALL stay bound to the template ID and version it was created with. A successful creation SHALL respond `201` with the draft DTO.

#### Scenario: Create from a published version

- **WHEN** a client posts `{ "templateId": "memory-box", "templateVersion": "1.0.0" }` and that version is published with a registered artifact
- **THEN** the response is `201` with `data.gift.status` `draft`, `data.gift.revision` `0`, and `data.gift.content` `{}`

#### Scenario: Unknown or unpublished version

- **WHEN** the requested template version does not exist or is not `published`
- **THEN** the response is `404` with code `NOT_FOUND`, and no draft is created

#### Scenario: Published version without an artifact

- **WHEN** a client posts `{ "templateId": "future-template", "templateVersion": "1.0.0" }`, a version that is `published` but has no registered artifact
- **THEN** the response is `404` with code `NOT_FOUND`, and no draft is created

#### Scenario: Unexpected body fields

- **WHEN** the create body contains a property other than `templateId` and `templateVersion`
- **THEN** the response is `400` with code `VALIDATION_ERROR`

### Requirement: Studio draft creation and editing flow

The studio page `/studio/new?template={templateId}` SHALL offer draft creation for a published template's current version when the catalog summary of that version is `available` (`template-catalog`). For a template whose current version is not `available`, the page SHALL show `Mẫu quà này sắp ra mắt.` with a link back to `/templates` and no create action. It SHALL generate one UUID `Idempotency-Key` per page instance and reuse that key on retries. After a successful creation it SHALL navigate to `/studio/{publicId}`. The editor SHALL present the template fields in steps, with the inputs, counters and validation specified in `studio-editor`. It SHALL persist changes through the autosave specified in `studio-autosave`, which sends the last known `revision` as `expectedRevision` and keeps unsaved on-screen content when a save fails. The editor SHALL NOT show revision numbers such as `Revision 1` in its normal state; a revision number appears only in the conflict banner. `imageList` and `captionedImageList` fields SHALL be rendered by the Studio image field specified in `studio-image-list-field`. An `audio` field SHALL be rendered as a single choice between `Không dùng nhạc`, which removes the field from the content, and each selectable track of the licensed audio catalog, labelled with its title and artist. When no track is selectable, the audio field SHALL state `Chưa có nhạc để chọn` and leave the field empty. A stored track id that is not selectable SHALL be shown as unavailable, with an inline field error, until the creator chooses again, and the Studio SHALL NOT send content that still carries it.

#### Scenario: Create then edit

- **WHEN** a visitor starts a draft from `/studio/new?template=memory-box`, types valid text into one field and pauses
- **THEN** the browser navigates to `/studio/{publicId}`, the save status shows `Đã lưu` after the autosave, and reloading the page shows the typed text

#### Scenario: Template that is not yet available

- **WHEN** a visitor opens `/studio/new?template=future-template` and its published current version has no registered artifact
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
