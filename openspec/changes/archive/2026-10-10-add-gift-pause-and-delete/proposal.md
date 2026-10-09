# Add gift pause and delete

## Why

An owner cannot take back a share link once it is sent, and cannot delete a gift: only a database
edit can. Gate M5 (plan.md §15.7) requires that "User có thể pause/delete không cần can thiệp trực
tiếp database". PO decision A4 ([sprint-6-plan.md](../../../docs/sprints/sprint-6-plan.md)) says a
deleted gift's link dies at once and its data is purged within 24 hours, keeping only a tombstone
and a minimal audit record. This is Sprint 6 change 4 (plan.md §13.1 and §15.3), which also closes
the risk "Published share links cannot be revoked".

## What Changes

- **Pause and resume.**
  - **Pause.** The signed-in owner of a published gift can pause it from the Studio
    (`Tạm dừng chia sẻ`). The share link then answers like an unknown one, with no gift data.
  - **Resume.** The owner can resume it (`Tiếp tục chia sẻ`) while its entitlement has not
    expired. The same share link works again; it is never regenerated.
  - **The Studio of a paused gift** shows a paused panel with resume and delete, and no editor.
- **Delete.** The owner can delete a draft (including an anonymous draft from its own browser), a
  published gift or a paused gift from the Studio (`Xoá món quà`, confirmed).
  - The gift moves to `deleting` at once. From then on its share link, Studio page, preview and
    every gift API answer not-found.
  - A background job `gift.delete.v1` is enqueued in the same transaction.
- **`gift.delete.v1`** purges, idempotently and with retries:
  - every stored object of the gift's photos (source and derivatives); the photos themselves move
    to `deleted`;
  - its revisions, publications, preview tokens and idempotency records;
  - its other pending jobs;
  - its analytics events.

  It then replaces the gift with a tombstone (ids and times, no content) kept for 1 year, and
  records `gift.deleted` in the audit log.

- **Deletion status.** The delete response states that the gift is deleting and the time by which
  it is purged. Admin gift lookup shows a deleting gift's status, and shows `Đã xoá` with its times
  for a tombstone.
- **Schema version 14:**
  - a `giftTombstones` collection (with a 365-day expiry);
  - an `analyticsEvents` index on `giftRef`, so deletion does not scan the collection;
  - the rate-limit scope `gift-lifecycle` for pause, resume and delete.
- **Rate limit.** Pause, resume and delete share the `gift-lifecycle` scope: 20 requests per 600
  seconds.

## Capabilities

### New Capabilities

- `gift-lifecycle`: pause, resume, delete, the deletion job and tombstones.

### Modified Capabilities

- `gift-publishing`: "Published gift in the Studio": the pause and delete controls, and the
  paused panel.
- `admin-access`: "Admin gift lookup": deleting and deleted gifts.
- `audit-log`: "Audit records": `gift.deleted`.
- `mutation-request-guards`: "Distributed mutation rate limits": the `gift-lifecycle` scope.
- `database-schema-management`: "Collection registry", "JSON-schema validators", "Named indexes",
  "Idempotent migration with ledger" and "Schema verification", for version 14.

## Non-goals

- Admin pause (takedown) and its owner notice: change 5, `add-abuse-reports-and-takedown`.
- An owner dashboard listing gifts. Pause and delete live in each gift's Studio page.
- Deleting a whole account, or a deletion request flow by email.
- Automatic deletion after expiry (`gift.expire`, which waits for change 6's retention table).
- Undo after delete. The confirmation says it is final.
- Editing a paused gift. Resume first.

## Impact

- **Code.**
  - `packages/domain` (paused and deleting gifts, `pausedAt`, `deletionRequestedAt`);
  - `modules/gifts` (service methods, repository writes, three routes, Studio controls);
  - `modules/media` (asset purge for a gift);
  - `modules/jobs` registration;
  - `modules/analytics` (delete events by gift);
  - the admin lookup;
  - `packages/database` (schema version 14).
- **Invariants.**
  - **Owner authorization in the data filter, opaque 404:** kept. Each write filters by the owner
    accessors and the expected status. Non-owners and deleted gifts get the same not-found.
  - **No content in tombstones, audit records or logs:** the tombstone holds only ids and times.
    The job logs only its id, type and error codes.
  - **Retryable work through the outbox:** the purge runs only in `gift.delete.v1`. The request
    just moves the gift to `deleting` and enqueues the job.
  - **Protected payloads never in public caches:** unchanged (`/g` is `private, no-store`). A
    recipient's already-signed photo URLs stop working once the job deletes the objects; they
    expire after 300 seconds anyway.
  - **Publish idempotency:** a deleting or paused gift cannot be published or updated. The existing
    conditional writes require `draft` or `published`.
