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
- for any other failure, including a network error: `Chưa mở được bản xem trước — thử lại.`

The `Xuất bản` step SHALL show a `Xuất bản` button. It SHALL be disabled, with one explanation, in the first of these cases that applies:

- the draft is anonymous: `Đăng nhập và lưu quà vào tài khoản để xuất bản.`, followed by the claim action of `gift-draft-ownership` when the viewer is signed in, or otherwise a link `Đăng nhập để xuất bản` to `/auth/sign-in?next=/studio/{publicId}`;
- the internal publish entitlement of `gift-publishing` is off: `Xuất bản chưa được mở cho tài khoản này.`;
- a template step is `Còn thiếu`: `Hoàn thiện các bước còn thiếu để xuất bản.`

Otherwise the button SHALL be enabled, with the note `Sau khi xuất bản, bạn không thể chỉnh sửa món quà này.`. Choosing `Xuất bản` SHALL work as follows:

1. The Studio SHALL first settle pending saves as specified in `studio-autosave` ("Pending saves settled before dependent Studio actions").
2. Only when the draft is saved at that point SHALL the Studio send `POST /api/gifts/{publicId}/publish` with the body `{ "expectedRevision": <revision of the last successful save> }` and an `Idempotency-Key` UUID. The Studio SHALL generate one key per page instance and reuse it for every publish attempt of that page.
3. On `201` the Studio SHALL stop autosave and replace the editor with the published panel of `gift-publishing` ("Published gift in the Studio") for the returned `shareId`, without a page reload.

While the action runs, the button SHALL be disabled and read `Đang xuất bản…`, so repeated clicks send at most one request. When the saves do not settle as saved, no publish request SHALL be sent, and the matching save status, invalid-content message, conflict banner or non-editable alert stays visible. When the publish request fails, the Studio SHALL stay on the page with the content unchanged and handle the response as follows:

- `400`: show `Chưa xuất bản được: một số nội dung chưa sẵn sàng.`, list the label of each field named by the first path segment of an `error.fieldErrors` key, each with a `Sửa` link to `/studio/{publicId}?field={fieldId}`, and show the errors inline on those fields as for a rejected save;
- `401`: `Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để xuất bản.`, with a link to `/auth/sign-in?next=/studio/{publicId}`;
- `403`: `Xuất bản chưa được mở cho tài khoản này.`;
- `404`: the non-editable alert `Bản nháp này không còn chỉnh sửa được. Hãy tải lại trang.`, with autosave stopped as for a `404` save;
- `409` with `error.details.actualRevision`: the revision conflict banner of `studio-autosave` ("Explicit revision conflict resolution");
- `409` with `error.details.reason` `TEMPLATE_VERSION_UNPUBLISHABLE` or `TEMPLATE_VERSION_NOT_EDITABLE`: `Phiên bản mẫu của món quà này không hỗ trợ xuất bản.`;
- `409` with `error.details.reason` `ACCESS_POLICY_UNSUPPORTED`: `Chế độ truy cập của món quà này chưa hỗ trợ xuất bản.`;
- `409` without `error.details`: reload the page, so that a gift published elsewhere shows its published panel;
- `429`: `Bạn thử xuất bản quá nhiều lần. Hãy thử lại sau {retryAfterSeconds} giây.`;
- any other failure, including a network error or an invalid `201` body: `Chưa xuất bản được — thử lại.`

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

- **WHEN** a signed-in creator opens step `Xuất bản` of an anonymous draft held by this browser
- **THEN** the claim action is shown and `Xuất bản` is disabled, and after a successful claim `Xuất bản` becomes enabled

#### Scenario: Publishing not enabled

- **WHEN** the owner opens step `Xuất bản` while the internal publish entitlement is off
- **THEN** the `Xuất bản` button is disabled with `Xuất bản chưa được mở cho tài khoản này.`

#### Scenario: Incomplete steps block publishing

- **WHEN** the owner opens step `Xuất bản` while step `memories` is `Còn thiếu`
- **THEN** the `Xuất bản` button is disabled with `Hoàn thiện các bước còn thiếu để xuất bản.`

#### Scenario: Publish after a pending change

- **WHEN** every step is `Đã xong`, a change is waiting for the autosave delay, and the owner chooses `Xuất bản`
- **THEN** the change is saved first, then exactly one publish request is sent with `expectedRevision` equal to the revision of that save, and on `201` the published panel with `Đã xuất bản` replaces the editor

#### Scenario: Publish rejected content

- **WHEN** the publish request is answered `400` with an `error.fieldErrors` entry `memories.2`
- **THEN** the Studio shows `Chưa xuất bản được: một số nội dung chưa sẵn sàng.`, lists the `memories` field label with a `Sửa` link to `/studio/{publicId}?field=memories`, and shows the error on that field

#### Scenario: Publish request fails

- **WHEN** the publish request fails with a network error, and the owner chooses `Xuất bản` again
- **THEN** `Chưa xuất bản được — thử lại.` is shown after the first attempt, and the second request carries the same `Idempotency-Key`

#### Scenario: Double click on publish

- **WHEN** the owner clicks `Xuất bản` twice quickly
- **THEN** the button reads `Đang xuất bản…` and is disabled after the first click, and one publish request is sent

#### Scenario: Template version cannot be published

- **WHEN** the publish request is answered `409` with `error.details.reason` `TEMPLATE_VERSION_NOT_EDITABLE`
- **THEN** the Studio stays on the page without reloading and shows `Phiên bản mẫu của món quà này không hỗ trợ xuất bản.`

#### Scenario: Gift published in another tab

- **WHEN** the publish request is answered `409` without `error.details`
- **THEN** the page reloads and shows the published panel of the gift
