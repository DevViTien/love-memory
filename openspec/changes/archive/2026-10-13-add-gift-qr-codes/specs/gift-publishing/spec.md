# Spec Delta

## MODIFIED Requirements

### Requirement: Published gift in the Studio

`/studio/{publicId}` SHALL show, when the gift is `published` and the request is authorized for it
under the draft access rules of `gift-draft-ownership`, a published panel above the editor of
`studio-editor`. The editor edits the gift's working copy (see "Editing a published gift"). The
panel SHALL show:

- the heading `Đã xuất bản`;
- the absolute share URL (the application origin followed by `/g/{shareId}`) in a read-only field
  labelled `Đường dẫn món quà`;
- a `Sao chép liên kết` button. It copies the URL and then reads `Đã sao chép`. When copying fails,
  the panel shows `Không sao chép được — hãy chọn đường dẫn và sao chép thủ công.`;
- a link `Mở món quà` to `/g/{shareId}`;
- the plan line `Gói {planName} · Người nhận mở được đến {expiry}.`, where `{planName}` is the
  name of the entitlement's plan in `gift-plans` and `{expiry}` is `expiresAt` formatted as
  `HH:mm dd/MM/yyyy` in the `Asia/Ho_Chi_Minh` time zone. Once `expiresAt` has passed, the line
  SHALL instead read `Món quà đã hết hạn lúc {expiry}. Người nhận không còn mở được.`;
- the status `Có thay đổi chưa cập nhật. Người nhận vẫn đang xem bản đã gửi trước đó.` while the
  gift has unpublished changes, and otherwise `Người nhận đang xem bản mới nhất.`. The status SHALL
  follow each successful save and each successful update without a page reload;
- the note `Ai có đường dẫn này đều mở được món quà. Chỉ chia sẻ với người nhận.`;
- the section `Mã QR` of `gift-qr-codes`, with the share URL as a QR code in three styles and its
  `Tải PNG` and `Tải SVG` downloads;
- the owner controls `Tạm dừng chia sẻ` and `Xoá món quà` of `gift-lifecycle` "Owner controls in the
  Studio".

The page SHALL autosave the working copy as for a draft (`studio-autosave`). For a `paused` gift the
page SHALL show the paused panel of `gift-lifecycle` instead of the published panel and the editor.
For a gift in any other status other than `draft` or `published`, or for an unauthorized request,
the page SHALL render the not-found page.

#### Scenario: Owner reopens a published gift

- **WHEN** the owner opens `/studio/{publicId}` of a published gift without unpublished changes
- **THEN** the page shows `Đã xuất bản`, the share URL ending in `/g/{shareId}`,
  `Người nhận đang xem bản mới nhất.` and the editor with the gift's content

#### Scenario: Someone else opens the Studio URL

- **WHEN** a browser without the owner's session opens `/studio/{publicId}` of a published gift
- **THEN** the not-found page is rendered

#### Scenario: Copy the link

- **WHEN** the owner chooses `Sao chép liên kết` and the clipboard accepts the text
- **THEN** the clipboard holds the absolute share URL and the button reads `Đã sao chép`

#### Scenario: Unpublished changes shown after a save

- **WHEN** the owner edits a caption of a published gift and the autosave answers `200`
- **THEN** the panel shows `Có thay đổi chưa cập nhật. Người nhận vẫn đang xem bản đã gửi trước
đó.` without a reload

#### Scenario: Plan and expiry shown

- **WHEN** the owner opens a gift first published on `free` at `2026-10-08T10:00:00Z`
- **THEN** the panel shows `Gói Miễn phí · Người nhận mở được đến 17:00 22/10/2026.`

#### Scenario: Expired gift in the Studio

- **WHEN** the owner opens that gift after `2026-10-22T10:00:00Z`
- **THEN** the panel shows `Món quà đã hết hạn lúc 17:00 22/10/2026. Người nhận không còn mở
được.`, and the editor stays editable

#### Scenario: QR code in the panel

- **WHEN** the owner opens `/studio/{publicId}` of a published gift
- **THEN** the panel shows `Mã QR` with a code of the share URL, `Tải PNG` and `Tải SVG`

#### Scenario: Paused gift in the Studio

- **WHEN** the owner opens `/studio/{publicId}` of a paused gift
- **THEN** the page shows `Đã tạm dừng chia sẻ` with `Tiếp tục chia sẻ` and `Xoá món quà`, and no
  editor
