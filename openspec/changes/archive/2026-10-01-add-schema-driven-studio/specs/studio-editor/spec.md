## Purpose

Defines how the Studio at `/studio/{publicId}` presents a gift draft for editing: steps derived from the bound template manifest plus the Studio's own preview and publish steps, URL addressing of steps and fields, inputs with counters, client-side validation with inline errors, and per-step completion. Saving is specified in `studio-autosave`; the image field is specified in `studio-image-list-field`; server-side validation is specified in `gift-drafts`.

## ADDED Requirements

### Requirement: Steps from the template manifest

The Studio SHALL present the draft's fields in the steps resolved from its bound template version: the manifest's `steps` in declared order, or, without `steps`, a single step `content` labelled `Nội dung` that holds every field. The template steps SHALL be followed by two Studio steps, `preview` labelled `Xem trước` and `publish` labelled `Xuất bản`. A step navigation labelled `Các bước tạo quà` SHALL list every step with its 1-based position and label, mark the active step with `aria-current="step"`, and let the creator open any step directly. When the steps do not fit the screen width, the step navigation SHALL scroll horizontally within itself; the Studio page MUST NOT become wider than the viewport. The active step SHALL show only its own fields, in the order of its `fieldIds`, with a `Quay lại` action (absent on the first step) and a `Tiếp tục` action (absent on the last step). Moving between steps MUST NOT be blocked by missing or invalid content, and MUST NOT discard unsaved content or cancel uploads of fields on other steps.

#### Scenario: Template with declared steps

- **WHEN** the editor opens a `memory-box@1.1.0` draft whose manifest declares the steps `recipient`, `opening`, `memories`, `letter` and `style`
- **THEN** the navigation lists `Người nhận`, `Lời mở hộp`, `Kỷ niệm`, `Lá thư`, `Giao diện & nhạc`, `Xem trước` and `Xuất bản` in that order, and only the fields of `recipient` are shown

#### Scenario: Step list on a phone

- **WHEN** the editor opens a `memory-box@1.1.0` draft on a 412 CSS-pixel-wide phone screen
- **THEN** the step navigation scrolls sideways within itself, the page has no horizontal scroll, and `Tiếp tục` can be tapped

#### Scenario: Manifest without steps

- **WHEN** the editor opens a draft whose template version declares no `steps`
- **THEN** the navigation lists `Nội dung`, `Xem trước` and `Xuất bản`, and `Nội dung` shows every field in declaration order

#### Scenario: Incomplete step does not block navigation

- **WHEN** a required field of the active step is empty and the creator chooses `Tiếp tục`
- **THEN** the next step opens, and the empty field keeps its state on the previous step

#### Scenario: Content kept across steps

- **WHEN** the creator types text on one step, opens another step and comes back before the autosave runs
- **THEN** the typed text is still shown and is still sent by the next autosave

### Requirement: Step and field addressing in the URL

The Studio SHALL reflect the active step in the query parameter `step` of `/studio/{publicId}`. Opening a step from the navigation or with `Quay lại` / `Tiếp tục` SHALL add a browser history entry with the new `step` value without reloading the page, so the browser's back action returns to the previous step. When the page loads, the Studio SHALL resolve its location in this order:

1. A `field` parameter that names a field of the bound template version opens the step that holds that field, scrolls the field into view and moves keyboard focus to the field's first input (for an image field, its `Chọn ảnh` file picker). When that input cannot take focus, such as an image picker disabled at `maxItems` or while a crop is open, or when it becomes disabled while focused because the saved images finish loading, keyboard focus SHALL move to the field's legend instead of being lost. The `step` parameter is then ignored.
2. Otherwise, a `step` parameter that names a step opens that step.
3. Otherwise, including when `field` or `step` names nothing, the first step opens. Unknown values MUST NOT produce an error page.

After resolving a `field` deep link, the Studio SHALL replace the URL with the equivalent `step` value so a reload does not move focus again. When the creator changes steps, the Studio SHALL move keyboard focus to the new step's heading.

#### Scenario: Deep link to a field

- **WHEN** the creator opens `/studio/{publicId}?field=final-letter` for a draft whose `final-letter` field belongs to step `letter`
- **THEN** the `letter` step is active, the `final-letter` input has keyboard focus, and the URL becomes `/studio/{publicId}?step=letter`

#### Scenario: Deep link wins over the step parameter

- **WHEN** the URL has both `step=recipient` and `field=memories`, and `memories` belongs to step `memories`
- **THEN** the `memories` step is active and its image picker has keyboard focus

#### Scenario: Deep link to a full image field

- **WHEN** the creator opens `/studio/{publicId}?field=memories` for a draft whose `memories` field already holds `maxItems` images
- **THEN** the `memories` step is active and, once the picker is disabled, keyboard focus is on the field's legend `Kỷ niệm`

#### Scenario: Unknown field or step

- **WHEN** the URL has `field=not-a-field` or `step=not-a-step`
- **THEN** the page renders normally with the first step active

#### Scenario: Back returns to the previous step

- **WHEN** the creator moves from step `recipient` to step `opening` with `Tiếp tục` and then uses the browser's back action
- **THEN** step `recipient` is active again, the URL has `step=recipient`, and no on-screen content is lost

#### Scenario: Focus follows a step change

- **WHEN** the creator opens step `letter` from the navigation
- **THEN** keyboard focus moves to the heading of step `letter`

### Requirement: Field inputs and counters

Each field SHALL be rendered in its step with its `label` and, when `required` is `true`, the marker `Bắt buộc`. `shortText` fields SHALL use a single-line input and `longText` fields a multi-line input; both SHALL stop input at the field's `maxLength` and show a counter `{n}/{maxLength}`, where `n` counts characters the way server validation does (UTF-16 code units, so an emoji can count as 2). `date` fields SHALL use a date input, `theme` fields a single choice among the field's `options`, and `audio`, `imageList` and `captionedImageList` fields SHALL be rendered as specified in `gift-drafts` and `studio-image-list-field`. A text value that is empty after trimming SHALL be removed from the draft content instead of being kept as whitespace, and a cleared date or theme SHALL be removed as well; the text input itself SHALL keep showing what the creator typed, so a first space typed into an empty field does not disappear.

#### Scenario: Character counter

- **WHEN** the creator types `Người thương` into a `shortText` field with `maxLength` 40
- **THEN** the counter shows `12/40`

#### Scenario: Input stops at the limit

- **WHEN** the creator types or pastes 130 characters into a `shortText` field with `maxLength` 120
- **THEN** the input keeps 120 characters and the counter shows `120/120`

#### Scenario: Whitespace-only text removed

- **WHEN** the creator replaces the text of a `longText` field with only spaces and line breaks
- **THEN** the field's key is removed from the draft content, so the autosave does not send an invalid empty text
- **AND** the input still shows the typed spaces and line breaks

#### Scenario: Leading space kept while typing

- **WHEN** the creator types a space and then `Linh` into an empty `shortText` field
- **THEN** the input shows ` Linh` and the counter shows `5/40` for a field with `maxLength` 40

### Requirement: Client-side validation and inline field errors

The Studio SHALL validate the on-screen content after every change with the same draft rules that the server applies to the bound template version (`gift-drafts` content validation), except the asset existence and ownership checks, which only the server performs. An `audio` value that is not a selectable catalog track SHALL also be an error. Each error SHALL be shown next to its field as a Vietnamese message, the field's input SHALL carry `aria-invalid="true"` and reference the message with `aria-describedby`, and content with any client-side error SHALL NOT be sent by autosave. Because the invalid field can be on a step that is not active, the save status SHALL then name the first invalid field and link to it, as specified in `studio-autosave` ("Save status messages"). When a save is rejected with `400` `VALIDATION_ERROR`, the Studio SHALL map each `fieldErrors` key to the field named by its first `.`-separated segment and show the message `Nội dung này chưa hợp lệ, hãy kiểm tra lại.` on that field; keys that name no field of the template (such as `content`) SHALL be shown once as the general message `Một số nội dung chưa hợp lệ với mẫu quà này.`. A field's server error SHALL be cleared as soon as the creator changes that field. Server error texts SHALL NOT be shown to the creator.

#### Scenario: Unavailable audio track blocks sending

- **WHEN** a draft stores a withdrawn track id and the editor opens it
- **THEN** the audio field shows `Bản nhạc này không còn khả dụng, hãy chọn lại.`, is marked `aria-invalid="true"`, the save status names that field with a `Sửa` link, and no save request is sent until the creator chooses `Không dùng nhạc` or an available track

#### Scenario: Nested server error mapped to its field

- **WHEN** a save is rejected with `error.fieldErrors` `{ "memories.1.caption": "Too long" }`
- **THEN** the `memories` field shows `Nội dung này chưa hợp lệ, hãy kiểm tra lại.` and the text `Too long` is not shown

#### Scenario: Error without a field

- **WHEN** a save is rejected with `error.fieldErrors` `{ "content": "Unrecognized key" }`
- **THEN** the general message `Một số nội dung chưa hợp lệ với mẫu quà này.` is shown and no field is marked invalid

#### Scenario: Server error cleared by editing

- **WHEN** the `memories` field shows a server error and the creator reorders its images
- **THEN** the error disappears from the `memories` field

### Requirement: Step completion state

The Studio SHALL compute a completion state for every template step from the on-screen content with the full (non-draft) payload rules of `template-manifest-contract`: a step is complete when every `required` field of the step has a value, every value of the step satisfies the full rules including `minItems`, and none of the step's fields has a client-side error. The navigation SHALL show each template step as `Đã xong` or `Còn thiếu`, and the state SHALL be part of the step's accessible name. The completion state is advisory: it MUST NOT block navigation or saving.

#### Scenario: Required field missing

- **WHEN** step `recipient` has an empty required `receiver-name` field
- **THEN** step `recipient` is shown as `Còn thiếu`

#### Scenario: Too few photos

- **WHEN** step `memories` holds 2 images in a field with `minItems` 3
- **THEN** step `memories` is shown as `Còn thiếu`, and the 2 images are still autosaved

#### Scenario: Step with only optional fields

- **WHEN** step `style` holds only optional fields and none has a value
- **THEN** step `style` is shown as `Đã xong`

#### Scenario: Step becomes complete

- **WHEN** the creator fills the last missing required field of a step with a valid value
- **THEN** that step changes to `Đã xong` without a page reload

### Requirement: Studio preview and publish steps

The `Xem trước` and `Xuất bản` steps SHALL show a readiness summary: every template step that is `Còn thiếu`, each with a `Sửa` link that opens that step, or the text `Tất cả các bước đã sẵn sàng.` when none is. Until the preview and publish capabilities specify their actions, each of these steps SHALL show its action button (`Xem trước` or `Xuất bản`) disabled, with the note `Sắp ra mắt`. Opening these steps MUST NOT send any request other than the autosave.

#### Scenario: Incomplete steps listed

- **WHEN** steps `memories` and `letter` are `Còn thiếu` and the creator opens `Xem trước`
- **THEN** the summary lists `Kỷ niệm` and `Lá thư`, each with a `Sửa` link, and choosing `Sửa` next to `Lá thư` opens step `letter`

#### Scenario: Action not yet available

- **WHEN** every template step is `Đã xong` and the creator opens `Xuất bản`
- **THEN** the summary shows `Tất cả các bước đã sẵn sàng.`, and the `Xuất bản` button is disabled with the note `Sắp ra mắt`
