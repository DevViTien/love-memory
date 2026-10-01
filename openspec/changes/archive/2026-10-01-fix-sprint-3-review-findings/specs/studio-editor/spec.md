## MODIFIED Requirements

### Requirement: Field inputs and counters

Each field SHALL be rendered in its step with its `label` and, when `required` is `true`, the marker `Bắt buộc`. `shortText` fields SHALL use a single-line input and `longText` fields a multi-line input; both SHALL stop input at the field's `maxLength` and show a counter `{n}/{maxLength}`, where `n` counts characters the way server validation does (UTF-16 code units, so an emoji can count as 2). `date` fields SHALL use a date input, `theme` fields a single choice among the field's `options`, and `audio`, `imageList` and `captionedImageList` fields SHALL be rendered as specified in `gift-drafts` and `studio-image-list-field`. Each theme option SHALL be labelled with its Vietnamese name (`rose-night` → `Đêm hồng`, `warm-paper` → `Giấy ấm`), and an option without a known name SHALL show its id. Because a template applies the first option when no theme is chosen, the empty choice SHALL read `Mặc định ({name of the first option})`; theme ids such as `rose-night` MUST NOT be shown for options that have a name. A text value that is empty after trimming SHALL be removed from the draft content instead of being kept as whitespace, and a cleared date or theme SHALL be removed as well; the text input itself SHALL keep showing what the creator typed, so a first space typed into an empty field does not disappear.

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

#### Scenario: Theme names

- **WHEN** the editor renders the `theme` field of `memory-box@1.1.0` with the options `rose-night` and `warm-paper` and no stored value
- **THEN** the choices read `Mặc định (Đêm hồng)`, `Đêm hồng` and `Giấy ấm`, the empty choice is selected, and no choice shows `rose-night` or `warm-paper`

### Requirement: Studio preview and publish steps

The `Xem trước` and `Xuất bản` steps SHALL show a readiness summary: every template step that is `Còn thiếu`, each with a `Sửa` link that opens that step, or the text `Tất cả các bước đã sẵn sàng.` when none is. Opening these steps MUST NOT send any request other than the autosave.

The `Xem trước` step SHALL show an enabled `Xem trước` action, whatever the completion state of the steps. Missing content is reported by the preview itself (`gift-preview`). Choosing `Xem trước` SHALL work as follows:

1. The Studio SHALL first settle pending saves as specified in `studio-autosave` ("Pending saves settled before dependent Studio actions").
2. Only when the draft is saved at that point SHALL the Studio send `POST /api/gifts/{publicId}/preview` with the body `{}`.
3. On `201` it SHALL open the returned `url` in the same browser tab.

While the action runs, the button SHALL be disabled and read `Đang mở bản xem trước…`, so repeated clicks send at most one request. It stays so while the page navigates to the preview; when the browser later restores the Studio page from its back/forward cache, the button SHALL be enabled again. When the saves do not settle as saved, no preview request SHALL be sent, and the matching save status, invalid-content message, conflict banner or non-editable alert stays visible. When the preview request fails, the Studio SHALL stay on the page with the content unchanged and show:

- for `429`: `Bạn mở xem trước quá nhiều lần. Hãy thử lại sau {retryAfterSeconds} giây.`;
- for `404`: the non-editable alert `Bản nháp này không còn chỉnh sửa được. Hãy tải lại trang.`, with autosave stopped as for a `404` save;
- for any other failure, including a network error or no answer within 15 seconds (the request is then aborted): `Chưa mở được bản xem trước — thử lại.`

The `Xuất bản` step SHALL show a `Xuất bản` button. It SHALL be disabled, with one explanation, in the first of these cases that applies:

- the bound template version cannot be published because no template artifact is registered for it (`template-artifact-delivery`): `Phiên bản mẫu của món quà này không hỗ trợ xuất bản.`;
- the draft is anonymous: `Đăng nhập và lưu quà vào tài khoản để xuất bản.`, followed by the claim action of `gift-draft-ownership` when the viewer is signed in (the Studio normally claims such a draft automatically, so this is shown only when that claim did not succeed), or otherwise a link `Đăng nhập để xuất bản` to `/auth/sign-in?next=/studio/{publicId}`;
- the internal publish entitlement of `gift-publishing` is off: `Xuất bản chưa được mở cho tài khoản này.`;
- a template step is `Còn thiếu`: `Hoàn thiện các bước còn thiếu để xuất bản.`

Otherwise the button SHALL be enabled, with the note `Sau khi xuất bản, bạn không thể chỉnh sửa món quà này.`. Choosing `Xuất bản` SHALL NOT send any request. It SHALL replace the button with a confirmation that has the heading `Xuất bản món quà này?`, the text `Sau khi xuất bản, bạn chưa thể chỉnh sửa hay thu hồi món quà. Ai có đường dẫn đều mở được món quà.`, and two actions, `Xác nhận xuất bản` and `Quay lại chỉnh sửa`. Keyboard focus SHALL move to the confirmation heading. `Quay lại chỉnh sửa` SHALL close the confirmation and show `Xuất bản` again. Choosing `Xác nhận xuất bản` SHALL work as follows:

1. The Studio SHALL first settle pending saves as specified in `studio-autosave` ("Pending saves settled before dependent Studio actions").
2. Only when the draft is saved at that point SHALL the Studio send `POST /api/gifts/{publicId}/publish` with the body `{ "expectedRevision": <revision of the last successful save> }` and an `Idempotency-Key` UUID. The Studio SHALL generate one key per page instance and reuse it for every publish attempt of that page.
3. On `201` the Studio SHALL stop autosave and replace the editor with the published panel of `gift-publishing` ("Published gift in the Studio") for the returned `shareId`, without a page reload.

While the action runs, `Xác nhận xuất bản` and `Quay lại chỉnh sửa` SHALL be disabled and `Xác nhận xuất bản` SHALL read `Đang xuất bản…`, so repeated clicks send at most one request, and the editor's fields SHALL be read-only as specified in "Read-only editor states". When the action ends without `201`, the confirmation SHALL close and `Xuất bản` is shown again with the outcome below. When the saves do not settle as saved, no publish request SHALL be sent, and the matching save status, invalid-content message, conflict banner or non-editable alert stays visible. When the publish request fails, the Studio SHALL stay on the page with the content unchanged and handle the response as follows:

- `400`: show `Chưa xuất bản được: một số nội dung chưa sẵn sàng.`, list the label of each field named by the first path segment of an `error.fieldErrors` key, each with a `Sửa` link to `/studio/{publicId}?field={fieldId}`, and show the errors inline on those fields as for a rejected save;
- `401`: `Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để xuất bản.`, with a link to `/auth/sign-in?next=/studio/{publicId}`;
- `403`: `Xuất bản chưa được mở cho tài khoản này.`;
- `404`: the non-editable alert `Bản nháp này không còn chỉnh sửa được. Hãy tải lại trang.`, with autosave stopped as for a `404` save;
- `409` with `error.details.actualRevision`: the revision conflict banner of `studio-autosave` ("Explicit revision conflict resolution");
- `409` with `error.details.reason` `TEMPLATE_VERSION_UNPUBLISHABLE` or `TEMPLATE_VERSION_NOT_EDITABLE`: `Phiên bản mẫu của món quà này không hỗ trợ xuất bản.`;
- `409` with `error.details.reason` `ACCESS_POLICY_UNSUPPORTED`: `Chế độ truy cập của món quà này chưa hỗ trợ xuất bản.`;
- `409` without `error.details`: reload the page, so that a gift published elsewhere shows its published panel;
- `429`: `Bạn thử xuất bản quá nhiều lần. Hãy thử lại sau {retryAfterSeconds} giây.`;
- any other failure, including a network error, an invalid `201` body, or no answer within 30 seconds (the request is then aborted; because the next attempt reuses the same `Idempotency-Key`, a publish that did succeed is answered as its replay): `Chưa xuất bản được — thử lại.`

#### Scenario: Incomplete steps listed

- **WHEN** steps `memories` and `letter` are `Còn thiếu` and the creator opens `Xem trước`
- **THEN** the summary lists `Kỷ niệm` and `Lá thư`, each with a `Sửa` link, and choosing `Sửa` next to `Lá thư` opens step `letter`

#### Scenario: Action not yet available

- **WHEN** every template step is `Đã xong`, internal publishing is not available because the internal publish entitlement of `gift-publishing` is off (`INTERNAL_PUBLISH_ENABLED` is not `true`), and the owner opens `Xuất bản`
- **THEN** the summary shows `Tất cả các bước đã sẵn sàng.`, and the `Xuất bản` button is disabled with the explanation `Xuất bản chưa được mở cho tài khoản này.`

#### Scenario: Preview after a pending change

- **WHEN** a change is waiting for the autosave delay and the creator chooses `Xem trước`
- **THEN** the change is saved first, then exactly one `POST /api/gifts/{publicId}/preview` is sent, and the browser opens the returned `/preview/{token}` URL in the same tab

#### Scenario: Preview of an incomplete draft

- **WHEN** step `memories` is `Còn thiếu`, the draft is saved, and the creator chooses `Xem trước`
- **THEN** the preview link is requested and opened

#### Scenario: Preview blocked by an unsaved state

- **WHEN** the creator chooses `Xem trước` while offline, while the content has a client-side error, or while a revision conflict is unresolved
- **THEN** no preview request is sent, and the offline status, the invalid-content message or the conflict banner stays visible

#### Scenario: Preview rate limited

- **WHEN** the preview request is answered `429` with `error.details.retryAfterSeconds` `120`
- **THEN** the Studio stays on the page and shows `Bạn mở xem trước quá nhiều lần. Hãy thử lại sau 120 giây.`

#### Scenario: Preview request never answers

- **WHEN** the preview request has not answered 15 seconds after it was sent
- **THEN** the request is aborted, the Studio stays on the page and shows `Chưa mở được bản xem trước — thử lại.`, and `Xem trước` is enabled again

#### Scenario: Preview request fails

- **WHEN** the preview request fails with a network error or a `500`
- **THEN** the Studio stays on the page, the on-screen content is unchanged, and `Chưa mở được bản xem trước — thử lại.` is shown

#### Scenario: Double click

- **WHEN** the creator clicks `Xem trước` twice quickly
- **THEN** the button is disabled after the first click and one preview request is sent

#### Scenario: Back from the preview

- **WHEN** the creator opened a preview and returns with the browser's back button, and the Studio page is restored from the back/forward cache
- **THEN** the `Xem trước` button is enabled again and a click sends a new preview request

#### Scenario: Anonymous draft must be claimed

- **WHEN** a visitor without a session opens step `Xuất bản` of an anonymous draft whose steps are all `Đã xong`
- **THEN** the `Xuất bản` button is disabled, `Đăng nhập và lưu quà vào tài khoản để xuất bản.` is shown with the link `Đăng nhập để xuất bản`, and no publish request can be sent

#### Scenario: Signed in with an unclaimed draft

- **WHEN** a signed-in creator opens step `Xuất bản` of an anonymous draft held by this browser whose automatic claim did not succeed
- **THEN** the claim action is shown and `Xuất bản` is disabled, and after a successful claim `Xuất bản` becomes enabled

#### Scenario: Publishing not enabled

- **WHEN** the owner opens step `Xuất bản` while the internal publish entitlement is off
- **THEN** the `Xuất bản` button is disabled with `Xuất bản chưa được mở cho tài khoản này.`

#### Scenario: Incomplete steps block publishing

- **WHEN** the owner opens step `Xuất bản` while step `memories` is `Còn thiếu`
- **THEN** the `Xuất bản` button is disabled with `Hoàn thiện các bước còn thiếu để xuất bản.`

#### Scenario: Publish asks for confirmation

- **WHEN** every step is `Đã xong` and the owner chooses `Xuất bản`
- **THEN** no request is sent, and the confirmation `Xuất bản món quà này?` with `Xác nhận xuất bản` and `Quay lại chỉnh sửa` is shown

#### Scenario: Confirmation cancelled

- **WHEN** the owner chooses `Quay lại chỉnh sửa` in the confirmation
- **THEN** the confirmation closes, `Xuất bản` is shown again, and no publish request was sent

#### Scenario: Publish after a pending change

- **WHEN** every step is `Đã xong`, a change is waiting for the autosave delay, and the owner chooses `Xuất bản` and then `Xác nhận xuất bản`
- **THEN** the change is saved first, then exactly one publish request is sent with `expectedRevision` equal to the revision of that save, and on `201` the published panel with `Đã xuất bản` replaces the editor

#### Scenario: Publish rejected content

- **WHEN** the publish request is answered `400` with an `error.fieldErrors` entry `memories.2`
- **THEN** the Studio shows `Chưa xuất bản được: một số nội dung chưa sẵn sàng.`, lists the `memories` field label with a `Sửa` link to `/studio/{publicId}?field=memories`, and shows the error on that field

#### Scenario: Publish request fails

- **WHEN** the publish request fails with a network error, and the owner chooses `Xuất bản` and `Xác nhận xuất bản` again
- **THEN** `Chưa xuất bản được — thử lại.` is shown after the first attempt, and the second request carries the same `Idempotency-Key`

#### Scenario: Publish request never answers

- **WHEN** the publish request has not answered 30 seconds after it was sent
- **THEN** the request is aborted, `Chưa xuất bản được — thử lại.` is shown, the fields are editable again, and the next attempt carries the same `Idempotency-Key`

#### Scenario: Double click on publish

- **WHEN** the owner clicks `Xác nhận xuất bản` twice quickly
- **THEN** the button reads `Đang xuất bản…` and is disabled after the first click, and one publish request is sent

#### Scenario: Template version without an artifact

- **WHEN** the owner opens step `Xuất bản` of a draft bound to `our-timeline@1.0.0`, which has no registered artifact, with every step `Đã xong`
- **THEN** the `Xuất bản` button is disabled with `Phiên bản mẫu của món quà này không hỗ trợ xuất bản.`

#### Scenario: Template version cannot be published

- **WHEN** the publish request is answered `409` with `error.details.reason` `TEMPLATE_VERSION_NOT_EDITABLE`
- **THEN** the Studio stays on the page without reloading and shows `Phiên bản mẫu của món quà này không hỗ trợ xuất bản.`

#### Scenario: Gift published in another tab

- **WHEN** the publish request is answered `409` without `error.details`
- **THEN** the page reloads and shows the published panel of the gift

## ADDED Requirements

### Requirement: Read-only editor states

The Studio SHALL make every field of the editor read-only, so that on-screen content cannot change, in two states:

- while a publish request started by `Xác nhận xuất bản` is running. When it ends without `201`, the fields SHALL become editable again with the content unchanged;
- after the draft became non-editable, that is once the alert `Bản nháp này không còn chỉnh sửa được. Hãy tải lại trang.` is shown (`studio-autosave`). The fields stay read-only for the lifetime of the page.

Read-only means: text, date and choice inputs are disabled; the image field disables its picker, captions, reorder, retry, complete-upload and delete actions; and a change that still reaches the editor (for example the order reported by an upload that finishes meanwhile) SHALL NOT change the on-screen content.

#### Scenario: Typing while publishing

- **WHEN** the publish request is in flight and the creator tries to type into `receiver-name`
- **THEN** the input is disabled and its text does not change, and after a `201` the published panel shows the content that was published

#### Scenario: Publish fails and editing resumes

- **WHEN** the publish request fails with `Chưa xuất bản được — thử lại.`
- **THEN** every field is editable again and shows the same content as before the attempt

#### Scenario: Draft no longer editable

- **WHEN** a save returns `404` and the non-editable alert is shown
- **THEN** every field is read-only from then on

### Requirement: Notice for template versions that cannot be published

When the draft's bound template version has no registered template artifact (`template-artifact-delivery`), for example a draft created on a placeholder version or on a version that was later retired without an artifact, the Studio SHALL show, above the step navigation and from the moment the editor opens, the notice `Phiên bản mẫu của bản nháp này chưa hỗ trợ xuất bản. Bạn vẫn có thể chỉnh sửa và xem trước, nhưng chưa thể gửi quà.` with `role="note"`. The notice is advisory for editing and previewing; `Xuất bản` stays disabled as specified in "Studio preview and publish steps". A draft whose version has a registered artifact SHALL NOT show the notice.

#### Scenario: Draft on a version without an artifact

- **WHEN** the editor opens a draft bound to `midnight-wish@1.0.0`, which has no registered artifact
- **THEN** the notice is shown above the step navigation before the creator edits anything

#### Scenario: Draft on a publishable version

- **WHEN** the editor opens a draft bound to `memory-box@1.1.0`
- **THEN** no notice about the template version is shown
