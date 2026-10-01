## Purpose

Defines how the Studio persists a gift draft while the creator edits it: debounced single-flight autosave with a manual `Lưu ngay` action, the save status messages, retry and offline behavior, the unsaved-changes warning, settling pending saves before dependent Studio actions, and explicit resolution of revision conflicts. The save API and its revision rules are specified in `gift-drafts`; request guards and rate limits are specified in `mutation-request-guards`.

## ADDED Requirements

### Requirement: Debounced single-flight autosave

The Studio SHALL save the draft automatically through `PATCH /api/gifts/{publicId}` with the complete on-screen content and the last known `revision` as `expectedRevision`. It SHALL send a save 1500 milliseconds after the last change to the content, restarting that delay on every further change. It MUST have at most one save request in flight per editor: a save that becomes due while a request is in flight SHALL wait until that request finishes and SHALL then send the latest content, with the revision returned by the finished request, so intermediate content is never sent. The Studio SHALL NOT send content that is equal to the last saved content, and SHALL NOT send content that has a client-side validation error (`studio-editor`). The last saved content is the content of the last successful save or, before any save, the content loaded with the page. After a successful save, the Studio SHALL record `data.gift.revision` as the last known revision and SHALL keep the on-screen content as it is, so that text typed while the request was in flight is neither replaced nor lost.

#### Scenario: One save after a typing burst

- **WHEN** the creator types ten characters with less than 1500 milliseconds between keystrokes and then stops
- **THEN** exactly one save request is sent, 1500 milliseconds after the last keystroke, and it carries all ten characters

#### Scenario: Changes during a save are sent next

- **WHEN** a save with `expectedRevision` `3` is in flight, the creator makes two more changes, and the request then succeeds with revision `4`
- **THEN** no second request starts before the first finishes, and the next request carries the content after both changes with `expectedRevision` `4`

#### Scenario: Unchanged content not sent

- **WHEN** the creator types a character and deletes it again within 1500 milliseconds of the last successful save
- **THEN** no save request is sent and the status stays `Đã lưu`

#### Scenario: Typing during a save is kept

- **WHEN** the creator keeps typing while a save request is in flight and the response carries the trimmed content that was sent
- **THEN** the on-screen text still shows everything the creator typed

### Requirement: Manual save action

The Studio SHALL offer a `Lưu ngay` button that sends the latest content at once, without waiting for the 1500-millisecond delay, following the same single-flight and validation rules as autosave. When a request is in flight, `Lưu ngay` SHALL send the latest content as soon as that request finishes. The button SHALL be disabled when there is nothing to save, while the content has a client-side validation error, while a revision conflict is unresolved, and after the draft has become non-editable.

#### Scenario: Save immediately

- **WHEN** the creator types into a field and chooses `Lưu ngay` within 1500 milliseconds
- **THEN** a save request is sent at once and no further request is sent for that change when the delay would have ended

#### Scenario: Nothing to save

- **WHEN** the status is `Đã lưu`
- **THEN** `Lưu ngay` is disabled

### Requirement: Save status messages

Outside a revision conflict, the Studio SHALL show exactly one of these save status messages in a region with `role="status"`, which is announced politely and never moves focus. The first matching row wins:

| Message                                                       | Shown when                                                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Chưa lưu được: {label} chưa hợp lệ` followed by a `Sửa` link | the on-screen content has a client-side validation error (`studio-editor`) and therefore cannot be sent                |
| `Mất kết nối — sẽ lưu khi có mạng`                            | the last save failed because the network was unavailable, or the browser reported `offline` while changes were unsaved |
| `Chưa lưu được — thử lại`                                     | the last save failed while the browser was online                                                                      |
| `Đang lưu…`                                                   | a change is waiting for the autosave delay or a save request is in flight                                              |
| `Đã lưu`                                                      | the on-screen content equals the last saved content and no request is in flight                                        |

In the invalid-content message, `{label}` is the `label` of the first invalid field, taking steps in navigation order and fields in step order. Its `Sửa` link SHALL point to `/studio/{publicId}?field={fieldId}` for that field and, when followed, SHALL open that field's step and focus the field as a `field` deep link does (`studio-editor`), even when the field is on a step that is not active. When the page opens, the status SHALL be `Đã lưu`, unless the loaded content already has a client-side validation error, for example a stored track that is no longer selectable; the invalid-content message SHALL then be shown instead.

#### Scenario: Status during and after a save

- **WHEN** the creator types into a field, waits for the autosave, and the request succeeds
- **THEN** the status shows `Đang lưu…` from the first keystroke until the response and then `Đã lưu`

#### Scenario: Invalid field on another step

- **WHEN** the creator is on step `recipient` and the `audio` field labelled `Nhạc nền` on step `style` holds a track that is no longer selectable
- **THEN** the status shows `Chưa lưu được: Nhạc nền chưa hợp lệ` with a `Sửa` link to `?field=audio`, no save request is sent, and following the link opens step `style` with the audio field focused

#### Scenario: Invalid stored content when the page opens

- **WHEN** the editor opens a draft whose stored content has a client-side validation error
- **THEN** the initial status is the invalid-content message for that field, not `Đã lưu`, and no save request is sent

#### Scenario: Status after the error is fixed

- **WHEN** the creator fixes the only invalid field
- **THEN** the invalid-content message disappears, the status shows `Đang lưu…`, and the content is autosaved

### Requirement: Save failure, retry and offline handling

The Studio SHALL keep the on-screen content after every failed save and SHALL handle each outcome as follows:

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

#### Scenario: Retries exhausted

- **WHEN** a save and its 3 automatic retries all return `500`
- **THEN** no further request is sent until the creator changes the content, chooses `Lưu ngay`, or the browser fires `online`

#### Scenario: Draft no longer editable

- **WHEN** a save returns `404` because the draft was claimed by another account or is no longer a draft
- **THEN** the alert `Bản nháp này không còn chỉnh sửa được. Hãy tải lại trang.` is shown, `Lưu ngay` is disabled, and no further save request is sent

### Requirement: Unsaved-changes warning

The Studio SHALL ask the browser to confirm leaving the page through the `beforeunload` event only while at least one of these holds: the on-screen content differs from the last saved content, a save request is in flight, or a revision conflict is unresolved. It MUST NOT do so otherwise; in particular, loaded content that has a client-side validation error does not by itself trigger the warning. When the page becomes hidden (`visibilitychange` to `hidden`, or `pagehide`) or the creator leaves the editor through an in-app link while a change is waiting for the autosave delay, the Studio SHALL send that change at once, unless the browser is offline, a conflict is unresolved, or the content has a client-side error. When a save is in flight at that moment, the Studio SHALL wait for its response and then send the changes typed meanwhile, with the revision from that response.

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

#### Scenario: Switching apps on a phone

- **WHEN** the creator types into a field and switches to another app within 1500 milliseconds
- **THEN** the Studio sends the change at once instead of waiting for the delay

#### Scenario: Leaving the editor during a save

- **WHEN** a save is in flight, the creator types more, and then leaves the editor through an in-app link
- **THEN** after the in-flight save succeeds with revision `n`, the Studio sends the complete on-screen content with `expectedRevision` `n`

### Requirement: Pending saves settled before dependent Studio actions

Every Studio action that depends on the stored draft, such as previewing the current draft or publishing with an `expectedRevision`, SHALL first settle pending saves: cancel the autosave delay, send the latest content when it differs from the last saved content (following the single-flight and validation rules above), and wait for every in-flight request. The action SHALL run only when the draft is saved at that point, and SHALL use the revision of the last successful save. Otherwise the action SHALL NOT run, and the Studio SHALL leave the matching save status, invalid-content message, conflict banner or non-editable alert visible instead.

#### Scenario: Action waits for a pending change

- **WHEN** a change is waiting for the autosave delay, the draft is at revision `4`, and the creator starts a dependent action
- **THEN** the change is sent at once, and the action runs only after that save succeeds, with revision `5`

#### Scenario: Action waits for an in-flight save

- **WHEN** a save is in flight and the creator starts a dependent action
- **THEN** the action waits for that save, any content changed meanwhile is sent next, and the action runs with the revision of the last successful save

#### Scenario: Action blocked by an unsaved state

- **WHEN** the creator starts a dependent action while offline, while the content has a client-side error, or while a revision conflict is unresolved
- **THEN** the action does not run, and the offline status, the invalid-content message or the conflict banner stays visible

### Requirement: Explicit revision conflict resolution

When a save is rejected with `409` `CONFLICT` and `error.details.actualRevision`, the Studio SHALL stop saving and show a banner with `role="alert"` stating `Bản nháp đã được lưu ở nơi khác (phiên bản {actualRevision}).` with two actions, `Tải bản mới nhất` and `Giữ bản của tôi`. While the banner is shown, the creator can keep editing; the Studio SHALL keep those edits on screen and MUST NOT send any save or resolve the conflict without one of the two actions.

- `Tải bản mới nhất` SHALL read the draft with `GET /api/gifts/{publicId}` and, on `200`, replace the on-screen content, the last saved content, the last known revision and every field error with the stored draft (image fields are seeded again from it), remove the banner, set the status as for a freshly opened page and resume autosave. If the read fails, the banner SHALL stay and show `Chưa tải được bản mới nhất — thử lại.`; a `404` SHALL be handled as a draft that is no longer editable.
- `Giữ bản của tôi` SHALL send the on-screen content with `expectedRevision` set to the `actualRevision` from the conflict. On success the banner SHALL be removed, the status SHALL become `Đã lưu` and autosave SHALL resume. A new `409` with `error.details.actualRevision` SHALL show the banner again with the new revision. Any other failure SHALL keep the banner and be reported as in the failure handling above.

#### Scenario: Conflict between two tabs

- **WHEN** the same draft is open in tabs A and B, tab A autosaves, and then the creator edits in tab B
- **THEN** tab B shows the banner with the revision saved by tab A, keeps its edits on screen, and sends no further save

#### Scenario: Load the latest version

- **WHEN** tab B chooses `Tải bản mới nhất`
- **THEN** tab B shows the content saved by tab A, the banner disappears, and the status is `Đã lưu`

#### Scenario: Keep my version

- **WHEN** tab B chooses `Giữ bản của tôi` after a conflict with `actualRevision` `5`
- **THEN** tab B sends its content with `expectedRevision` `5`, the stored draft becomes tab B's content at revision `6`, and the banner disappears

#### Scenario: Another save wins again

- **WHEN** tab B chooses `Giữ bản của tôi` but tab A has meanwhile saved revision `6`
- **THEN** the save is rejected with `409`, and the banner is shown again with revision `6`

#### Scenario: Reload fails

- **WHEN** tab B chooses `Tải bản mới nhất` while the network is unavailable
- **THEN** the banner stays, its message `Chưa tải được bản mới nhất — thử lại.` is shown, and tab B's on-screen content is unchanged
