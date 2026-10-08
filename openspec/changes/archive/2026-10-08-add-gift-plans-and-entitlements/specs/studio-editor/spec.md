# Spec Delta

## MODIFIED Requirements

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

For a draft, the `Xuất bản` step SHALL show a plan choice and a `Xuất bản` button. The plan choice is a radio group labelled `Chọn gói` with one option per plan of `gift-plans`, in catalog order, each built from the plan values the server rendered into the page (never from constants in the browser):

- the plan name (`Miễn phí`, `Tiêu chuẩn`) and its price: `Miễn phí` for `priceVnd` `0`, otherwise the amount with `.` thousands separators followed by `đ` (`49.000đ`);
- `Tối đa {maxPhotos} ảnh`, or `Tất cả ảnh mẫu quà cho phép` when `maxPhotos` is `null`;
- `Có dòng chữ “Tạo bằng LoveMemory”` when `watermark` is `true`, otherwise `Không có dòng chữ “Tạo bằng LoveMemory”`;
- `Người nhận mở được trong {retentionDays} ngày`, or `Người nhận mở được trong 1 năm` for `365`.

An option SHALL be disabled, with one explanation, in the first of these cases that applies:

- the plan is not available to the owner (`gift-plans` "Plan availability"): `Sắp mở thanh toán.`;
- the content's photo count exceeds the plan's `maxPhotos`: `Món quà đang có {photoCount} ảnh, gói này cho tối đa {maxPhotos} ảnh.`

A paid plan made available by the internal paid-plan grant SHALL show the note `Cấp nội bộ để thử nghiệm, không thu phí.`. The first enabled option SHALL be selected by default and the selection SHALL follow the creator's choice. When the selected option becomes disabled (for example after a photo is added), the selection SHALL move to the first enabled option, or to none.

The `Xuất bản` button SHALL be disabled, with one explanation, in the first of these cases that applies:

- the bound template version cannot be published because no template artifact is registered for it (`template-artifact-delivery`): `Phiên bản mẫu của món quà này không hỗ trợ xuất bản.`;
- the draft is anonymous: `Đăng nhập và lưu quà vào tài khoản để xuất bản.`, followed by the claim action of `gift-draft-ownership` when the viewer is signed in (the Studio normally claims such a draft automatically, so this is shown only when that claim did not succeed), or otherwise a link `Đăng nhập để xuất bản` to `/auth/sign-in?next=/studio/{publicId}`;
- a template step is `Còn thiếu`: `Hoàn thiện các bước còn thiếu để xuất bản.`;
- no plan is selected: `Chọn một gói để xuất bản.`

Otherwise the button SHALL be enabled, with the note `Sau khi xuất bản, bạn vẫn có thể chỉnh sửa và cập nhật món quà tại cùng đường dẫn.`. Choosing `Xuất bản` SHALL NOT send any request. It SHALL replace the button with a confirmation that has the heading `Xuất bản món quà này?`, the text `Ai có đường dẫn đều mở được món quà. Bạn có thể chỉnh sửa và cập nhật sau, nhưng chưa thể thu hồi đường dẫn.`, the line `Gói đã chọn: {planName}.`, and two actions, `Xác nhận xuất bản` and `Quay lại chỉnh sửa`. The plan choice SHALL be disabled while the confirmation is open.

For a published gift, the `Xuất bản` step SHALL show no plan choice, the line `Gói {planName}` of the gift's entitlement, and a `Cập nhật món quà` button instead. It SHALL be disabled, with one explanation, in the first of these cases that applies:

- the first case of the list above (no registered template artifact), with the same explanation;
- the gift's `expiresAt` has passed: `Món quà đã hết hạn nên không thể cập nhật.`;
- a template step is `Còn thiếu`: `Hoàn thiện các bước còn thiếu để cập nhật.`;
- the content's photo count exceeds the entitlement's `maxPhotos`: `Gói {planName} cho tối đa {maxPhotos} ảnh. Hãy bớt ảnh để cập nhật.`;
- the gift has no unpublished changes (`gift-publishing` "Editing a published gift") and no change is waiting to be saved: `Người nhận đang xem bản mới nhất. Hãy chỉnh sửa trước khi cập nhật.`

Otherwise it SHALL be enabled, with the note `Người nhận sẽ thấy nội dung mới tại đường dẫn hiện tại.`. Choosing `Cập nhật món quà` SHALL NOT send any request. It SHALL replace the button with a confirmation that has the heading `Cập nhật món quà đã gửi?`, the text `Người nhận sẽ thấy nội dung mới ngay tại đường dẫn hiện tại. Bản đã gửi trước đó sẽ không còn hiển thị.`, and two actions, `Xác nhận cập nhật` and `Quay lại chỉnh sửa`.

In both confirmations keyboard focus SHALL move to the confirmation heading, and `Quay lại chỉnh sửa` SHALL close the confirmation and show the button again. Choosing `Xác nhận xuất bản` or `Xác nhận cập nhật` SHALL work as follows:

1. The Studio SHALL first settle pending saves as specified in `studio-autosave` ("Pending saves settled before dependent Studio actions").
2. Only when the draft is saved at that point SHALL the Studio send `POST /api/gifts/{publicId}/publish` with the body `{ "expectedRevision": <revision of the last successful save>, "planId": <plan> }` and an `Idempotency-Key` UUID. `<plan>` is the selected plan for a draft, and the `planId` of the gift's entitlement for a published gift. The Studio SHALL generate a key per page instance and reuse it for every attempt until one is answered `201`; after each `201` it SHALL generate a new key for the next publish.
3. On `201` for a draft, the Studio SHALL show the published panel of `gift-publishing` ("Published gift in the Studio") for the returned `shareId`, `planId` and `expiresAt` above the editor, without a page reload, keep autosaving, and from then on offer `Cập nhật món quà`. On `201` for a published gift, the panel's status SHALL change to `Người nhận đang xem bản mới nhất.` and the step SHALL show `Đã cập nhật món quà.`

While the action runs, both confirmation actions SHALL be disabled, `Xác nhận xuất bản` SHALL read `Đang xuất bản…` and `Xác nhận cập nhật` SHALL read `Đang cập nhật…`, so repeated clicks send at most one request, and the editor's fields SHALL be read-only as specified in "Read-only editor states". When the action ends without `201`, the confirmation SHALL close and the button is shown again with the outcome below. When the saves do not settle as saved, no publish request SHALL be sent, and the matching save status, invalid-content message, conflict banner or non-editable alert stays visible. When the publish request fails, the Studio SHALL stay on the page with the content unchanged and handle the response as follows; for a published gift, the messages that say `xuất bản` use their update wording given in brackets:

- `400`: show `Chưa xuất bản được: một số nội dung chưa sẵn sàng.` (`Chưa cập nhật được: một số nội dung chưa sẵn sàng.`), list the label of each field named by the first path segment of an `error.fieldErrors` key, each with a `Sửa` link to `/studio/{publicId}?field={fieldId}`, and show the errors inline on those fields as for a rejected save;
- `401`: `Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để xuất bản.`, with a link to `/auth/sign-in?next=/studio/{publicId}`;
- `404`: the non-editable alert `Bản nháp này không còn chỉnh sửa được. Hãy tải lại trang.`, with autosave stopped as for a `404` save;
- `409` with `error.details.actualRevision`: the revision conflict banner of `studio-autosave` ("Explicit revision conflict resolution");
- `409` with `error.details.reason` `TEMPLATE_VERSION_UNPUBLISHABLE` or `TEMPLATE_VERSION_NOT_EDITABLE`: `Phiên bản mẫu của món quà này không hỗ trợ xuất bản.`;
- `409` with `error.details.reason` `ACCESS_POLICY_UNSUPPORTED`: `Chế độ truy cập của món quà này chưa hỗ trợ xuất bản.`;
- `409` with `error.details.reason` `PLAN_NOT_AVAILABLE`: `Gói này chưa mở cho tài khoản của bạn.`;
- `409` with `error.details.reason` `PLAN_PHOTO_LIMIT_EXCEEDED`: `Gói đã chọn cho tối đa {maxPhotos} ảnh, món quà đang có {photoCount} ảnh.`, with the values of `error.details`;
- `409` with `error.details.reason` `NO_UNPUBLISHED_CHANGES`, `PLAN_CHANGE_UNSUPPORTED` or `GIFT_EXPIRED`, or without `error.details`: reload the page, so that a gift published, updated or expired elsewhere shows its current state;
- `429`: `Bạn thử xuất bản quá nhiều lần. Hãy thử lại sau {retryAfterSeconds} giây.` (`Bạn thử cập nhật quá nhiều lần. Hãy thử lại sau {retryAfterSeconds} giây.`);
- any other failure, including a network error, an invalid `201` body, or no answer within 30 seconds (the request is then aborted; because the next attempt reuses the same `Idempotency-Key`, a publish that did succeed is answered as its replay): `Chưa xuất bản được — thử lại.` (`Chưa cập nhật được — thử lại.`)

#### Scenario: Incomplete steps listed

- **WHEN** steps `memories` and `letter` are `Còn thiếu` and the creator opens `Xem trước`
- **THEN** the summary lists `Kỷ niệm` and `Lá thư`, each with a `Sửa` link, and choosing `Sửa` next to `Lá thư` opens step `letter`

#### Scenario: Action not yet available

- **WHEN** every template step is `Đã xong`, the draft holds 5 photos, the internal paid-plan grant of `gift-plans` is off, and the owner opens `Xuất bản`
- **THEN** the summary shows `Tất cả các bước đã sẵn sàng.`, `Miễn phí` is disabled with `Món quà đang có 5 ảnh, gói này cho tối đa 3 ảnh.`, `Tiêu chuẩn` is disabled with `Sắp mở thanh toán.`, and the `Xuất bản` button is disabled with `Chọn một gói để xuất bản.`

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

- **WHEN** the owner opens step `Xuất bản` of a complete 3-photo draft while the internal paid-plan grant is off
- **THEN** `Miễn phí` is selected, `Tiêu chuẩn` is disabled with `Sắp mở thanh toán.`, and the `Xuất bản` button is enabled

#### Scenario: Incomplete steps block publishing

- **WHEN** the owner opens step `Xuất bản` while step `memories` is `Còn thiếu`
- **THEN** the `Xuất bản` button is disabled with `Hoàn thiện các bước còn thiếu để xuất bản.`

#### Scenario: Publish asks for confirmation

- **WHEN** every step is `Đã xong` and the owner chooses `Xuất bản`
- **THEN** no request is sent, and the confirmation `Xuất bản món quà này?` with `Gói đã chọn: Miễn phí.`, `Xác nhận xuất bản` and `Quay lại chỉnh sửa` is shown

#### Scenario: Confirmation cancelled

- **WHEN** the owner chooses `Quay lại chỉnh sửa` in the confirmation
- **THEN** the confirmation closes, `Xuất bản` is shown again, and no publish request was sent

#### Scenario: Publish after a pending change

- **WHEN** every step is `Đã xong`, a change is waiting for the autosave delay, and the owner chooses `Xuất bản` and then `Xác nhận xuất bản`
- **THEN** the change is saved first, then exactly one publish request is sent with `expectedRevision` equal to the revision of that save and the selected `planId`, and on `201` the published panel with `Đã xuất bản` appears above the editor, which stays editable

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

- **WHEN** the publish request is answered `409` with `error.details.reason` `NO_UNPUBLISHED_CHANGES`, or `409` without `error.details`
- **THEN** the page reloads and shows the published panel of the gift above the editor

#### Scenario: Nothing to update

- **WHEN** the owner opens step `Xuất bản` of a published gift without unpublished changes and with no change waiting to be saved
- **THEN** `Cập nhật món quà` is disabled with `Người nhận đang xem bản mới nhất. Hãy chỉnh sửa trước khi cập nhật.`

#### Scenario: Owner updates a published gift

- **WHEN** the owner edits `final-letter` of a published gift, chooses `Cập nhật món quà` and then `Xác nhận cập nhật`
- **THEN** the change is saved first, exactly one publish request is sent with the revision of that save and the `planId` of the gift's entitlement, and on `201` the panel shows `Người nhận đang xem bản mới nhất.` and the step shows `Đã cập nhật món quà.`

#### Scenario: New key after a success

- **WHEN** the owner first publishes a draft and later, in the same page, updates it
- **THEN** the update request carries an `Idempotency-Key` different from that of the first publish

#### Scenario: Update request fails

- **WHEN** the update request fails with a network error
- **THEN** `Chưa cập nhật được — thử lại.` is shown, recipients still receive the earlier publication, and the next attempt carries the same `Idempotency-Key`

#### Scenario: Standard through the internal grant

- **WHEN** the internal paid-plan grant is on and the owner of a complete 8-photo draft opens `Xuất bản`
- **THEN** `Miễn phí` is disabled with `Món quà đang có 8 ảnh, gói này cho tối đa 3 ảnh.`, `Tiêu chuẩn` is selected with `49.000đ` and `Cấp nội bộ để thử nghiệm, không thu phí.`, and confirming sends `planId` `standard`

#### Scenario: Selection follows the photo count

- **WHEN** `Miễn phí` is selected for a 3-photo draft, the internal paid-plan grant is on, and the creator adds a fourth photo
- **THEN** `Miễn phí` becomes disabled and `Tiêu chuẩn` becomes selected

#### Scenario: Photo limit refused by the server

- **WHEN** the publish request is answered `409` with `error.details.reason` `PLAN_PHOTO_LIMIT_EXCEEDED`, `error.details.maxPhotos` `3` and `error.details.photoCount` `4`
- **THEN** the Studio stays on the page and shows `Gói đã chọn cho tối đa 3 ảnh, món quà đang có 4 ảnh.`

#### Scenario: Expired gift cannot be updated

- **WHEN** the owner opens step `Xuất bản` of a published gift whose `expiresAt` has passed and which has unpublished changes
- **THEN** `Cập nhật món quà` is disabled with `Món quà đã hết hạn nên không thể cập nhật.`

#### Scenario: Free gift over its photo limit

- **WHEN** the owner of a gift published on `free` has 4 photos in the working copy
- **THEN** `Cập nhật món quà` is disabled with `Gói Miễn phí cho tối đa 3 ảnh. Hãy bớt ảnh để cập nhật.`
