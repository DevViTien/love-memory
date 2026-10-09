# gift-lifecycle Specification

## Purpose

Lets the owner of a gift withdraw it: pause a published gift and resume it later, or delete any of
their gifts for good. Deletion revokes access at once and purges the gift's content, photos and
derived records in the background, leaving only a tombstone of ids and times.

## Requirements

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

### Requirement: Delete a gift

The owner SHALL delete a gift with `POST /api/gifts/{publicId}/delete`. The route takes a strict
empty JSON body and passes the guards of `mutation-request-guards`, under the scope
`gift-lifecycle`.

- **Who.** A `draft` can be deleted by any accessor of `gift-draft-ownership`, including the
  browser of an anonymous draft. A `published` or `paused` gift can be deleted only by its
  signed-in owner.
- **The change.** The gift SHALL move to `deleting` and keep the time as `deletionRequestedAt`. In
  the same transaction, one `gift.delete.v1` job SHALL be enqueued for the gift.
- **The answer** is `202`, with `data.deletion` holding:
  - `status` `deleting`;
  - `requestedAt`;
  - `purgeBy`, 24 hours after `requestedAt`.

  Repeating the request while the gift is still `deleting` SHALL answer the same `202` and enqueue
  nothing new. An unknown or unauthorized gift, or one already purged, SHALL answer `404` with code
  `NOT_FOUND`.

- **Access ends at once.** From the moment it is `deleting`, the gift SHALL be not-found everywhere:
  - its share link and `GET /api/public-gifts/{shareId}`;
  - its Studio page, preview links and every `/api/gifts/{publicId}` route except this one.
- **Not reversible.** Deletion SHALL NOT be undone.

#### Scenario: Owner deletes a published gift

- **WHEN** the owner deletes a published gift
- **THEN** the response is `202` with `status` `deleting` and a `purgeBy` 24 hours later, the share
  link answers `404`, and `/studio/{publicId}` renders the not-found page

#### Scenario: Anonymous draft deleted from its browser

- **WHEN** the browser that holds an anonymous draft deletes it
- **THEN** the response is `202`, and the draft is gone from that browser's Studio

#### Scenario: Repeated delete

- **WHEN** the owner sends the delete request twice before the purge
- **THEN** both answers are `202` with the same `requestedAt`, and only one `gift.delete.v1` job
  exists

#### Scenario: Someone else deletes

- **WHEN** a browser without the owner's session sends the delete request for a published gift
- **THEN** the response is `404`, and the gift stays published

### Requirement: Deletion purge job

`gift.delete.v1` (`background-jobs`, payload `{ giftId }`) SHALL purge a `deleting` gift. It runs
with up to 8 attempts, which completes well within 24 hours of the request. Each step SHALL be safe
to repeat:

1. **Photos.** Every photo of the gift that is not yet `deleted` moves to `deleting`. Its source
   object and every derivative object are deleted from storage, and it then moves to `deleted`. A
   storage failure leaves the photo `deleting` and retries the job; the media expired-asset cleanup
   also finishes such photos.
2. **Derived records.** The gift's revisions, publications, preview tokens and idempotency records
   are deleted, and so are its other jobs that are not running.
3. **Analytics.** The gift's analytics events (matched by its `giftRef`) are deleted.
4. **Tombstone.** In one transaction:
   - the gift document is replaced by a tombstone in `giftTombstones`;
   - `gift.deleted` is recorded in the audit log, with actor `{ kind: "system", id: "gift.delete.v1" }`,
     the gift as target, and `{ photos, published }` as metadata.

**The tombstone** holds exactly:

- `_id` (the gift id) and `publicId`;
- `ownerId` (or `null`);
- `createdAt`, `publishedAt` (or `null`), `deletionRequestedAt` and `deletedAt`;
- `expiresAt`, 365 days after `deletedAt`.

It holds no content, share id, plan or photo reference. A job for a gift that is not `deleting`
(already purged, or never deleted) SHALL complete without changing anything. Gift text, share ids
and storage keys MUST NOT be logged.

#### Scenario: Purge of a published gift with photos

- **WHEN** `gift.delete.v1` runs for a deleting gift with three photos and two publications
- **THEN** every storage object of the three photos is deleted, the photos are `deleted`, no
  revision, publication or preview token of the gift remains, the gift document is gone, a tombstone
  exists, and `gift.deleted` is recorded with `{ photos: 3, published: true }`

#### Scenario: Storage failure is retried

- **WHEN** deleting one storage object fails
- **THEN** the job fails with a retryable error, the tombstone is not written yet, and a later
  attempt completes the purge

#### Scenario: Job for a gift already purged

- **WHEN** a duplicate `gift.delete.v1` runs after the tombstone exists
- **THEN** it completes and changes nothing

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
