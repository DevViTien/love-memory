## MODIFIED Requirements

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
