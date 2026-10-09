# Spec Delta

## MODIFIED Requirements

### Requirement: Pause and resume a published gift

The signed-in owner of a gift (`gift-draft-ownership`) SHALL pause it with
`POST /api/gifts/{publicId}/pause` and resume it with `POST /api/gifts/{publicId}/resume`. Both
take a strict empty JSON body and pass the guards of `mutation-request-guards`, under the rate-limit
scope `gift-lifecycle`.

- **Pause.** A `published` gift becomes `paused`, and the time is kept as `pausedAt`.
- **Resume.** A `paused` gift becomes `published` again, with the same share id, publication,
  entitlement and `expiresAt`, and `pausedAt` is removed. A paused gift whose `expiresAt` has passed
  SHALL NOT be resumed; the answer is `409` with code `CONFLICT` and `details.reason`
  `GIFT_EXPIRED`. A paused gift that holds a takedown (`abuse-reports` "Takedown") SHALL NOT
  be resumed by its owner; the answer is `409` with `details.reason` `GIFT_TAKEN_DOWN`.

**Answers.** Both answer `200` with `data.gift` holding `publicId` and `status`. Pausing a paused
gift, or resuming a published one, SHALL answer the same `200` and change nothing. Pausing or
resuming a `draft` SHALL answer `409` with `details.reason` `GIFT_NOT_PUBLISHED`. A request without
the owner's session, for an unknown gift, or for a gift being deleted SHALL answer `404` with code
`NOT_FOUND`.

**While paused**, the share link SHALL behave exactly like an unknown share id (`public-gift-viewer`),
with no gift data. The gift SHALL NOT be edited, previewed or published until resumed.

#### Scenario: Owner pauses a published gift

- **WHEN** the owner pauses a published gift
- **THEN** the response is `200` with `status` `paused`, and `GET /api/public-gifts/{shareId}`
  answers `404` like an unknown share id

#### Scenario: Owner resumes the gift

- **WHEN** the owner resumes it before its `expiresAt`
- **THEN** the response is `200` with `status` `published`, and the same share link opens the gift
  again

#### Scenario: Expired gift cannot be resumed

- **WHEN** the owner resumes a paused gift whose `expiresAt` has passed
- **THEN** the response is `409` with `details.reason` `GIFT_EXPIRED`, and the gift stays paused

#### Scenario: Someone else pauses

- **WHEN** a browser without the owner's session sends the pause request
- **THEN** the response is `404` with code `NOT_FOUND`, and the gift stays published

#### Scenario: Taken-down gift cannot be resumed

- **WHEN** the owner resumes a gift that an admin took down
- **THEN** the response is `409` with `details.reason` `GIFT_TAKEN_DOWN`, and the gift stays paused

### Requirement: Owner controls in the Studio

The Studio SHALL offer the owner these controls:

- **Published gift.** The published panel offers `Tạm dừng chia sẻ`, and a `Xoá món quà` action.
- **Draft.** The Studio offers `Xoá món quà`.
- **Paused gift.** `/studio/{publicId}` shows, instead of the editor, a panel with:
  - the heading `Đã tạm dừng chia sẻ`;
  - the text `Người nhận đang không mở được món quà. Đường dẫn cũ sẽ hoạt động lại khi bạn tiếp tục chia sẻ.`;
  - `Tiếp tục chia sẻ` and `Xoá món quà`.

  After its `expiresAt`, the panel shows `Món quà đã hết hạn nên không thể tiếp tục chia sẻ.` and no
  resume.

- **Taken-down gift.** When the paused gift holds a takedown, the panel shows instead the heading
  `Món quà đã bị tạm khoá` and the text
  `Món quà bị tạm khoá vì có báo cáo vi phạm quy định nội dung. Người nhận không mở được món quà. Bạn vẫn có thể xoá món quà.`,
  with `Xoá món quà` and no resume.

**Delete confirmation.** `Xoá món quà` SHALL ask for confirmation with the text
`Xoá vĩnh viễn món quà này? Người nhận sẽ không mở được nữa, và ảnh cùng nội dung sẽ bị xoá hẳn trong vòng 24 giờ. Không thể hoàn tác.`
After a successful delete, the page SHALL show `Đã xoá món quà.` with a link `Tạo món quà mới` to
`/studio/new`, and no editor.

A failed request SHALL show `Chưa thực hiện được — thử lại.` and change nothing on the page.

#### Scenario: Pause from the published panel

- **WHEN** the owner chooses `Tạm dừng chia sẻ` on a published gift
- **THEN** the page shows `Đã tạm dừng chia sẻ` with `Tiếp tục chia sẻ` and no editor

#### Scenario: Delete a draft from the Studio

- **WHEN** the owner chooses `Xoá món quà` on a draft and confirms
- **THEN** the page shows `Đã xoá món quà.` and a link to `/studio/new`

#### Scenario: Delete declined

- **WHEN** the owner chooses `Xoá món quà` and declines the confirmation
- **THEN** no request is sent and the gift is unchanged

#### Scenario: Owner sees the takedown notice

- **WHEN** the owner opens the Studio of a taken-down gift
- **THEN** the page shows `Món quà đã bị tạm khoá` with `Xoá món quà` and no `Tiếp tục chia sẻ`
