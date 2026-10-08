# gift-preview Specification

## Purpose

Lets a creator see a draft exactly as a recipient will before publishing. The creator gets a
short-lived private preview link. The preview page renders the current draft through the shared
viewer payload and gift viewer, adds viewport, restart, mute and reduced-motion controls, and lists
content issues with `Sửa` links back to the Studio fields.

## Requirements

### Requirement: Preview link issuance

The system SHALL accept `POST /api/gifts/{publicId}/preview` with a strict JSON body `{}`. The
checks and responses are:

- The request SHALL pass the guards of `mutation-request-guards` in their order: media type,
  origin, path, then the rate limit of scope `gift-preview`, then the body.
- The gift SHALL be authorized with the draft access rules of `gift-draft-ownership`.
- A malformed `publicId`, a request without credentials, a gift the caller cannot access, and a
  gift whose status is neither `draft` nor `published` SHALL respond `404` with code `NOT_FOUND`
  and the message `Gift draft was not found.`.
- A gift whose bound template version can no longer be resolved for editing SHALL respond `409`
  with code `CONFLICT`, as saving it does.
- On success the system SHALL create a preview token and respond `201` with
  `data` `{ url, expiresAt }`. `url` is `/preview/{token}`, and `expiresAt` is an ISO 8601
  timestamp 1800 seconds after issuance.

For a `published` gift the preview shows its working copy (`gift-publishing` "Editing a published
gift"), so the owner can check unpublished changes before updating the gift.

The token SHALL be 32 bytes from a cryptographically secure random source, encoded as unpadded
base64url (43 characters). The system SHALL store only the token's SHA-256 hash (lowercase hex),
with the gift's internal id, `createdAt` and `expiresAt`. It MUST NOT store, return in any other
form or log the token itself. Each successful request SHALL create a new token. Earlier tokens stay
valid until they expire.

#### Scenario: Owner requests a preview link

- **WHEN** the owner of draft `{publicId}` sends `POST /api/gifts/{publicId}/preview` with body `{}`
- **THEN** the response is `201` with `data.url` matching `/preview/` followed by 43 base64url
  characters, and `data.expiresAt` 30 minutes later
- **AND** the stored record holds the SHA-256 hash of the token, not the token

#### Scenario: Non-owner denied opaquely

- **WHEN** a requester without matching credentials sends the request for an existing draft
- **THEN** the response is `404` with code `NOT_FOUND`, identical to the response for a
  nonexistent `publicId`, and no token is created

#### Scenario: Published or deleted gift

- **WHEN** the owner requests a preview link for a published gift, and for a gift whose status is
  `deleted`
- **THEN** the published gift gets `201` with a preview link of its working copy, and the deleted
  gift gets `404` with code `NOT_FOUND` and no token is created

#### Scenario: Rate limit exceeded

- **WHEN** the same subject sends a 31st request within one 600-second `gift-preview` window
- **THEN** the response is `429` with code `RATE_LIMITED`, `error.details.retryAfterSeconds` and a
  matching `Retry-After` header, and no token is created

#### Scenario: Unexpected body or media type

- **WHEN** the request has `Content-Type: text/plain`, or the body `{ "ttl": 99999 }`
- **THEN** the response is `415` or `400` with code `VALIDATION_ERROR` respectively, and no token
  is created

#### Scenario: Unexpected failure

- **WHEN** the database throws while the token is stored
- **THEN** the response is `500` with code `INTERNAL_ERROR`, and the log entry holds only an event
  name and the request id

### Requirement: Opening a preview link

The system SHALL serve `/preview/{token}` as follows. It SHALL look up the SHA-256 hash of the path
token among the stored tokens whose `expiresAt` is later than the current time. The expiry is
checked on read, whatever the database's TTL deletion has done. It SHALL then read the bound gift
only when its status is `draft` or `published`, and render the gift's current content at the time
of the request: the last saved content of a draft, or the working copy of a published gift. That
is not a snapshot taken when the link was issued, and for a published gift it is not the content
recipients receive.

A valid token SHALL be the only credential the page needs. No session or cookie is required.

The page SHALL render the not-found page whenever any of these holds:

- the token is not exactly 43 base64url characters (then without any database access);
- no stored token matches;
- the token has expired;
- the gift no longer exists or its status is neither `draft` nor `published`;
- its template version can no longer be resolved.

The not-found page SHALL be identical in all these cases and SHALL be answered with HTTP status
`404`; the token check runs before any part of the response is streamed.

#### Scenario: Latest content shown

- **WHEN** the creator issues a preview link, then changes `receiver-name` in the Studio and the
  change is saved, then opens the link
- **THEN** the preview uses the changed `receiver-name`

#### Scenario: Preview link survives the first publish

- **WHEN** a preview link issued for a draft is opened, before it expires, after the draft was
  published and its working copy changed
- **THEN** the preview renders the working copy, not the published content

#### Scenario: Unknown or malformed token

- **WHEN** a visitor opens `/preview/` followed by 43 random base64url characters, or `/preview/abc`
- **THEN** the not-found page `Kỷ niệm này chưa tồn tại.` is rendered with HTTP status `404` and
  `X-Robots-Tag: noindex`

#### Scenario: Expired token

- **WHEN** a visitor opens a preview link 1801 seconds after it was issued, even though the TTL
  monitor has not yet deleted the record
- **THEN** the same not-found page is rendered

#### Scenario: Gift no longer a draft

- **WHEN** a valid preview link is opened after the gift left the `draft` status
- **THEN** the working copy is rendered when the gift is `published`, and the same not-found page is
  rendered for any other status

#### Scenario: Link opened on another device

- **WHEN** the creator opens a valid preview link in a browser with no session and no draft cookie
- **THEN** the preview is rendered

### Requirement: Preview response protection

Every response of `/preview/{token}`, including the not-found page, SHALL carry these headers:

- `Cache-Control` containing `private` and `no-store`;
- `X-Robots-Tag: noindex`;
- `Referrer-Policy: no-referrer`;
- the per-request nonce `Content-Security-Policy` of `content-security-policy`.

The page title SHALL be `Xem trước quà · LoveMemory`, with no gift content. The page SHALL render
per request and never from a prerendered output. The system MUST NOT write the token, the page URL
or signed asset URLs to application logs. The development server's incoming-request log SHALL
ignore paths that start with `/preview/`.

#### Scenario: Private headers

- **WHEN** a valid preview page is served by a production build
- **THEN** the response carries `Cache-Control` with `private` and `no-store`,
  `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, and a policy with `'strict-dynamic'`

#### Scenario: No gift text in metadata

- **WHEN** a preview page is served for a draft whose `receiver-name` is `An`
- **THEN** the document title is `Xem trước quà · LoveMemory` and no `<meta>` element contains `An`

### Requirement: Preview page and controls

The preview page SHALL render its gift viewer (`gift-viewer`) with a ready source: the viewer
payload (`viewer-payload`) built for the gift when the page is rendered. When the gift viewer asks
for fresh asset URLs, the page SHALL re-read the payload the same way, without restarting the gift.
The preview page MUST NOT turn the gift viewer's lifecycle notifications into recipient events.
Opening a preview is not opening a gift. It SHALL provide these controls:

- A viewport choice between `Điện thoại` (default: the frame is portrait 9:16, at most 24rem wide)
  and `Máy tính` (the frame fills the preview width at 16:10). The chosen button has
  `aria-pressed="true"`. Changing the viewport MUST NOT re-initialize the template, MUST take effect
  immediately, and SHALL stay available while a restart is pending.
- `Phát lại`: destroys the running template (`DESTROY`) and shows the envelope again for a new
  `INIT`. When the payload the page holds has an `assetsExpireAt` more than 60 seconds after the
  current time, or an `assetsExpireAt` of `null`, the restart SHALL happen in the browser with that
  payload, without any request to the server. Otherwise it SHALL re-read the current draft and sign
  fresh asset URLs first; if the link has expired meanwhile, the not-found page is shown.
- The gift viewer's mute control.
- `Giảm chuyển động`, a toggle with `aria-pressed`. Turning it on or off restarts the gift as
  `Phát lại` does, with `prefersReducedMotion` forced to `true`, or following the system again.
  Its `aria-pressed` value SHALL change as soon as it is pressed.

While a restart is pending, from the press until the new gift viewer reports that its runtime is
ready or has fallen back (`gift-viewer` "Runtime outcome notification"):

- the pressed control SHALL show a spinner and read `Đang phát lại…` (`Phát lại`) or
  `Đang áp dụng…` (`Giảm chuyển động`), carry `aria-busy="true"` and `aria-disabled="true"`, keep
  keyboard focus, and ignore further presses;
- the other restart control SHALL be disabled;
- the frame SHALL show an overlay with a spinner and `Đang tải lại bản xem trước…` in a polite live
  status region, covering the gift viewer and keeping it from receiving input;
- the control labels and the overlay MUST NOT change the size or position of the controls, the
  frame or the content below it, and the page MUST NOT scroll.

When a server re-read ends without delivering a new payload, the pending state SHALL end, the
running gift SHALL be kept, and the page SHALL show `Chưa tải lại được bản xem trước. Hãy thử lại.`
until the next restart.

When the gift viewer switches to its static fallback because of a template error or timeout, the
page SHALL show
`Đang hiển thị bản tĩnh vì mẫu quà không chạy được. Người nhận vẫn thấy đầy đủ nội dung.` directly
under the frame, until the next restart.

The page SHALL show the notice
`Liên kết xem trước riêng tư, hết hạn sau 30 phút. Đừng chia sẻ liên kết này.`. When the browser
can edit the draft (see "Issues panel"), it SHALL also show a link `Quay lại chỉnh sửa` to
`/studio/{publicId}?step=preview`.

#### Scenario: Switch to desktop viewport

- **WHEN** the creator chooses `Máy tính` while `memory-1` is showing
- **THEN** the frame widens, and no new `INIT` is sent and the scene is unchanged

#### Scenario: Fast restart with valid asset URLs

- **WHEN** the creator chooses `Phát lại` while the held `assetsExpireAt` is 4 minutes away
- **THEN** no request is sent to the server, the template receives `DESTROY`, a new iframe receives
  `INIT` with the same payload and asset URLs, and the envelope is shown again
- **AND** after `Mở quà` the animated template plays, not the static rendering

#### Scenario: Restart with fresh content

- **WHEN** the creator saves a new caption in another tab and then chooses `Phát lại` while the held
  `assetsExpireAt` is less than 60 seconds away or has passed
- **THEN** the page re-reads the draft, the template receives `DESTROY`, the envelope is shown
  again, and after `Mở quà` the new caption is shown

#### Scenario: Restart after expiry

- **WHEN** the creator chooses `Phát lại` 31 minutes after the link was issued and the held
  `assetsExpireAt` has passed
- **THEN** the not-found page is shown

#### Scenario: Reduced motion toggle

- **WHEN** the creator turns `Giảm chuyển động` on
- **THEN** the gift restarts from the envelope and the next `INIT` carries `prefersReducedMotion`
  `true`

#### Scenario: Pending feedback during a restart

- **WHEN** the creator chooses `Phát lại` and the new template has not answered `READY` yet
- **THEN** `Phát lại` reads `Đang phát lại…` with `aria-busy="true"`, `Giảm chuyển động` is
  disabled, `Máy tính` still works, and the frame shows `Đang tải lại bản xem trước…`
- **AND** once the template answers `READY`, the overlay disappears, the button reads `Phát lại`
  again without `aria-busy`, and the envelope is shown

#### Scenario: Repeated presses while pending

- **WHEN** the creator presses `Phát lại` three times quickly
- **THEN** the gift restarts once and at most one server re-read is made

#### Scenario: Pending ends with the fallback

- **WHEN** a restart is pending and the new template never answers `READY`
- **THEN** the pending state ends when the gift viewer falls back, and the fallback notice is shown
  under the frame

#### Scenario: Re-read without a new payload

- **WHEN** a server re-read for `Phát lại` completes without delivering a new payload
- **THEN** the pending state ends, the running gift is unchanged, and
  `Chưa tải lại được bản xem trước. Hãy thử lại.` is shown

#### Scenario: Template blocked by the deployment

- **WHEN** the template's runtime script cannot load (for example it is redirected to a sign-in
  page) and the gift viewer falls back after the `INIT` handshake times out
- **THEN** the page shows
  `Đang hiển thị bản tĩnh vì mẫu quà không chạy được. Người nhận vẫn thấy đầy đủ nội dung.` under
  the frame

### Requirement: Issues panel

The preview page SHALL show an issues panel headed `Cần hoàn thiện` that lists two kinds of issues:

- the `issues` of the viewer payload;
- the distinct template `ISSUE` events reported by the gift viewer.

Issues SHALL be merged by (`code`, `fieldId`, `itemIndex`) and ordered by field declaration order,
then `itemIndex`. Each issue whose `fieldId` names a manifest field SHALL be shown with the field's
label and a message chosen by code:

- `CONTENT_MISSING`: `{label}: chưa có nội dung.`;
- `CONTENT_TOO_FEW`: `{label}: cần ít nhất {minItems} ảnh.`, with the field's `minItems`;
- `CONTENT_INVALID` with an `itemIndex`: `{label}: mục {itemIndex + 1} chưa hợp lệ.`;
- `CONTENT_INVALID` without an `itemIndex`: `{label}: nội dung chưa hợp lệ.`;
- `ASSET_UNAVAILABLE`: `{label}: ảnh {itemIndex + 1} chưa sẵn sàng hoặc không tải được.`

Each such issue SHALL have a `Sửa` link to `/studio/{publicId}?field={fieldId}` when the browser
that opened the preview can edit the draft, meaning its session or draft cookie authorizes the
draft under `gift-draft-ownership`. Otherwise the panel SHALL show no `Sửa` links, and SHALL show
once `Mở Studio trên thiết bị đã tạo quà để sửa.`. The `Quay lại chỉnh sửa` link is hidden in
that case too. An `ISSUE` whose
`fieldId` names no manifest field SHALL be shown once as `Mẫu quà báo một nội dung chưa hiển thị
được.`, without a link. When the gift viewer switches to its static fallback because of a template
error or timeout, the panel SHALL also show
`Mẫu quà gặp lỗi khi hiển thị. Người nhận sẽ thấy bản tĩnh với đầy đủ nội dung.`. When there is no
issue, the panel SHALL show `Không phát hiện vấn đề nào.`.

#### Scenario: Missing fields and a broken photo

- **WHEN** a `memory-box` `1.1.0` draft has no `receiver-name` and 1 photo whose asset is `ready`
  but fails to load in the template
- **THEN** the panel lists, among the other missing fields and each with a `Sửa` link:
  - the label of `receiver-name` followed by `: chưa có nội dung.`;
  - the label of `memories` followed by `: cần ít nhất 3 ảnh.`;
  - the label of `memories` followed by `: ảnh 1 chưa sẵn sàng hoặc không tải được.`

#### Scenario: Same issue from server and template

- **WHEN** the viewer payload reports `CONTENT_MISSING` for `final-letter` and the template sends
  the same `ISSUE`
- **THEN** the panel lists it once

#### Scenario: Fix a field from the preview

- **WHEN** the creator chooses `Sửa` next to the `final-letter` issue
- **THEN** the browser opens `/studio/{publicId}?field=final-letter`, and the Studio focuses the
  `final-letter` input

#### Scenario: Preview opened on a device that cannot edit

- **WHEN** a valid preview link with issues is opened in a browser without the owner's session or
  draft cookie
- **THEN** the issues are listed without `Sửa` links, `Mở Studio trên thiết bị đã tạo quà để sửa.`
  is shown, and there is no `Quay lại chỉnh sửa` link

#### Scenario: Complete gift

- **WHEN** the draft passes full validation, every photo loads, and the template sends no `ISSUE`
- **THEN** the panel shows `Không phát hiện vấn đề nào.`

### Requirement: Preview of a version without an artifact

When the gift's bound template version has no registered artifact, such as a draft pinned to the
retired `memory-box` `1.0.0`, the preview page SHALL NOT fail. It SHALL show the notice
`Phiên bản mẫu của bản nháp này không hỗ trợ xem trước hiệu ứng.`, render the gift viewer's static
fallback of the content after `Mở quà`, and still show the issues panel from the viewer payload.

#### Scenario: Draft pinned to memory-box 1.0.0

- **WHEN** the owner of a draft bound to `memory-box` `1.0.0` issues a preview link and opens it
- **THEN** the page shows the notice and the issues panel, and after `Mở quà` it shows the stored
  text and images statically, with no template iframe and no error page
