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

Until the publish capability specifies its action, the `Xuất bản` step SHALL show its `Xuất bản` button disabled, with the note `Sắp ra mắt`.

#### Scenario: Incomplete steps listed

- **WHEN** steps `memories` and `letter` are `Còn thiếu` and the creator opens `Xem trước`
- **THEN** the summary lists `Kỷ niệm` and `Lá thư`, each with a `Sửa` link, and choosing `Sửa` next to `Lá thư` opens step `letter`

#### Scenario: Action not yet available

- **WHEN** every template step is `Đã xong` and the creator opens `Xuất bản`
- **THEN** the summary shows `Tất cả các bước đã sẵn sàng.`, and the `Xuất bản` button is disabled with the note `Sắp ra mắt`

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
