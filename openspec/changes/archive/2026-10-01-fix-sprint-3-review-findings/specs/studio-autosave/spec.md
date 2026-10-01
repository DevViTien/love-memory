## MODIFIED Requirements

### Requirement: Save failure, retry and offline handling

The Studio SHALL keep the on-screen content after every failed save and SHALL handle each outcome as follows. A save request that has not answered within 15 seconds SHALL be aborted and handled as a network failure (offline or online, by `navigator.onLine`), so a stalled connection can never keep the status on `Đang lưu…`; the read of `Tải bản mới nhất` has the same 15-second limit, and an aborted read is a failed read.

- A network failure while the browser reports `navigator.onLine` `false`, or an `offline` event with unsaved changes: status `Mất kết nối — sẽ lưu khi có mạng`, no retries while offline, and the latest content is sent as soon as the browser fires `online`.
- A network failure while online, a `5xx` response, a `429` `RATE_LIMITED` response, or a success status with a body that is not a valid draft response: status `Chưa lưu được — thử lại` and up to 3 automatic retries after 2, 4 and 8 seconds. A `429` retry SHALL NOT be sent before `error.details.retryAfterSeconds` have passed, and no other save (after a change, `Lưu ngay` or an `online` event) SHALL be sent inside that window either; it is sent when the window ends. After the third failed retry the Studio SHALL wait for the next change, `Lưu ngay` or an `online` event.
- `400` `VALIDATION_ERROR`: status `Chưa lưu được — thử lại`, the inline errors of `studio-editor`, and no automatic retry; the next change is autosaved normally.
- `404`, or `409` `CONFLICT` without `error.details.actualRevision`: the alert `Bản nháp này không còn chỉnh sửa được. Hãy tải lại trang.` is shown and the Studio SHALL send no further save for the lifetime of the page.
- `409` `CONFLICT` with `error.details.actualRevision`: the revision conflict handling below.
- Any other error response: status `Chưa lưu được — thử lại` and no automatic retry.

#### Scenario: Offline then back online

- **WHEN** the network is lost, the creator types, and the connection returns
- **THEN** the status shows `Mất kết nối — sẽ lưu khi có mạng` while offline, a save is sent when the browser fires `online`, and the status becomes `Đã lưu` after it succeeds

#### Scenario: Temporary server error retried

- **WHEN** a save returns `503` and the retry 2 seconds later succeeds
- **THEN** the status shows `Chưa lưu được — thử lại` in between and `Đã lưu` after the retry, without any creator action

#### Scenario: Rate limited

- **WHEN** a save returns `429` with `error.details.retryAfterSeconds` `20`
- **THEN** no save request is sent during the next 20 seconds, and the latest content is sent after that

#### Scenario: Back online during a rate-limit window

- **WHEN** a save returns `429` with `error.details.retryAfterSeconds` `20`, and 5 seconds later the browser fires `offline` and then `online`
- **THEN** no save request is sent before the 20 seconds have passed, and the latest content is sent when they have

#### Scenario: Stalled save

- **WHEN** a save request is sent while the browser is online and no response arrives within 15 seconds
- **THEN** the request is aborted, the status shows `Chưa lưu được — thử lại`, the on-screen content is unchanged, and the first automatic retry is sent 2 seconds later

#### Scenario: Dependent action during a rate-limit window

- **WHEN** a save returned `429` with `error.details.retryAfterSeconds` `20`, the creator then types, and within 1500 milliseconds the page is hidden or a dependent action starts
- **THEN** no save is sent inside the 20 seconds, the status shows `Chưa lưu được — thử lại`, and the latest content is sent when the 20 seconds have passed

#### Scenario: Retries exhausted

- **WHEN** a save and its 3 automatic retries all return `500`
- **THEN** no further request is sent until the creator changes the content, chooses `Lưu ngay`, or the browser fires `online`

#### Scenario: Draft no longer editable

- **WHEN** a save returns `404` because the draft was claimed by another account or is no longer a draft
- **THEN** the alert `Bản nháp này không còn chỉnh sửa được. Hãy tải lại trang.` is shown, `Lưu ngay` is disabled, and no further save request is sent

### Requirement: Unsaved-changes warning

The Studio SHALL ask the browser to confirm leaving the page through the `beforeunload` event only while at least one of these holds: the on-screen content differs from the last saved content, a save request is in flight, or a revision conflict is unresolved. It MUST NOT do so otherwise; in particular, loaded content that has a client-side validation error does not by itself trigger the warning, and once the draft became non-editable (the alert `Bản nháp này không còn chỉnh sửa được. Hãy tải lại trang.` is shown) nothing can be saved any more, so the Studio MUST NOT ask either. When the page becomes hidden (`visibilitychange` to `hidden`, or `pagehide`) or the creator leaves the editor through an in-app link while a change is waiting for the autosave delay, the Studio SHALL send that change at once, unless the browser is offline, a conflict is unresolved, or the content has a client-side error. When a save is in flight at that moment, the Studio SHALL wait for its response and then send the changes typed meanwhile, with the revision from that response.

#### Scenario: Leaving with unsaved changes

- **WHEN** the creator types into a field and reloads the page before the autosave has finished
- **THEN** the browser asks the creator to confirm leaving the page

#### Scenario: Leaving after a save

- **WHEN** the status is `Đã lưu` and the creator reloads the page
- **THEN** the page reloads without a confirmation prompt

#### Scenario: Leaving a draft whose stored content is invalid

- **WHEN** the editor opens a draft whose stored audio track is no longer selectable and the creator reloads the page without editing anything
- **THEN** the page reloads without a confirmation prompt, although the status shows the invalid-content message

#### Scenario: Leaving with an unsent invalid edit

- **WHEN** the creator makes an edit that leaves the content invalid and then reloads the page
- **THEN** the browser asks the creator to confirm leaving the page

#### Scenario: Leaving a draft that is no longer editable

- **WHEN** a save returned `404`, the non-editable alert is shown, and the creator reloads the page
- **THEN** the page reloads without a confirmation prompt

#### Scenario: Switching apps on a phone

- **WHEN** the creator types into a field and switches to another app within 1500 milliseconds
- **THEN** the Studio sends the change at once instead of waiting for the delay

#### Scenario: Leaving the editor during a save

- **WHEN** a save is in flight, the creator types more, and then leaves the editor through an in-app link
- **THEN** after the in-flight save succeeds with revision `n`, the Studio sends the complete on-screen content with `expectedRevision` `n`
