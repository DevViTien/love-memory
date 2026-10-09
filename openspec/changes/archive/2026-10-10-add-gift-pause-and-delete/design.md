# Design

## Context

For the why and the scope, see proposal.md. The relevant code at `cdc3fe7`:

- **Statuses.** `packages/domain/src/gift/gift-status.ts` already lists `paused`, `deleting` and
  `deleted`, and allows `published → paused`, `paused → published` and `* → deleting`. Nothing
  writes those statuses yet. `GiftSchema` is strict, and constrains only `draft` and `published`.
- **The gifts collection** validator allows additional properties and already enumerates every
  status.
- **Every read already fails closed on a non-`draft`/`published` status:**
  - the public share query requires `status: "published"`;
  - `getStudioGift`, `updateDraft` and `getDraft` require an editable status;
  - publish uses conditional writes on `draft`/`published`.

  So `paused` and `deleting` gifts are invisible to recipients and to the editor without any further
  change. Only the Studio's paused panel needs a new read.

- **Ownership.** `findAuthorized(publicId, accessors)` puts the owner filter in the query
  (`gift-draft-ownership`). Publish uses only the `user` accessor.
- **Jobs** (`background-jobs`):
  - `enqueueJob(database, { deduplicationKey, payload, type }, session)` inside a transaction;
  - handlers registered in `composition/jobs.ts`;
  - `JobFailure(code, retryable)`.

  The cleanup handler `gift.assets.cleanup.v1` shows the photo deletion pattern: conditional move to
  `deleting` with a 60-second `expiresAt` safety net, storage deletes, then `deleted`.

- **Analytics.** `analyticsEvents.giftRef` is the keyed HMAC of the gift id
  (`createGiftRefFactory(ANALYTICS_GIFT_REF_SECRET)`). There is no index on it.

Governing ADRs: ADR-0008 (Trigger.dev and the outbox), ADR-0001, ADR-0003 (object storage for
media), ADR-0010 (first-party analytics: events hold only the keyed gift ref).

## Goals / Non-Goals

**Goals:**

- The request only flips the status and enqueues the job; everything slow or retryable is in the
  job.
- Every step of the purge is idempotent.
- Nothing about a deleted gift's content remains, except the tombstone and the audit record.

**Non-Goals:** see proposal.md.

## Decisions

### 1. Domain

`GiftSchema` gains two fields:

- `pausedAt` (optional date);
- `deletionRequestedAt` (optional date).

The refinement treats `paused` exactly like `published`: it requires the share id, the publication
time and revision, the entitlement and the expiry. `deleting` has no extra constraint (a draft or a
published gift can be deleting). `GIFT_TRANSITIONS` is unchanged; the service uses
`canTransitionGift` for the checks below, so the state machine is the single source of truth.

### 2. Service and repository

`gift-service.ts` gains `pauseGift`, `resumeGift` and `deleteGift`.

**Reads.** Each reads the gift with `findAuthorized`:

- pause, resume, and deleting a published or paused gift use only the `user` accessor;
- deleting a draft uses every accessor.

**The decision** is made on the stored status:

| Request | Stored status                    | Result                                                       |
| ------- | -------------------------------- | ------------------------------------------------------------ |
| pause   | `published`                      | write `paused`                                               |
| pause   | `paused`                         | unchanged                                                    |
| pause   | `draft`                          | `GIFT_NOT_PUBLISHED`                                         |
| resume  | `paused`                         | write `published`, or `GIFT_EXPIRED` when `expiresAt <= now` |
| resume  | `published`                      | unchanged                                                    |
| resume  | `draft`                          | `GIFT_NOT_PUBLISHED`                                         |
| delete  | `draft` / `published` / `paused` | write `deleting` and enqueue the job                         |
| delete  | `deleting`                       | the same `202` with the stored `deletionRequestedAt`         |
| any     | anything else, or no access      | `NOT_FOUND`                                                  |

A published or paused gift found only through an anonymous accessor is also `NOT_FOUND` for delete.

**Repository writes.** Each is one conditional `updateOne` on `{ _id, status: <from> }`; a lost
race reports "unchanged" and the service re-reads.

- `pause(giftId, now)` sets `status: "paused"`, `pausedAt` and `updatedAt`.
- `resume(giftId, now)` filters also on `expiresAt: { $gt: now }`, and unsets `pausedAt`.
- `requestDeletion(giftId, now)` runs in one transaction:
  1. the move to `deleting` from `draft`, `published` or `paused`, setting `deletionRequestedAt`;
  2. `enqueueJob` of `gift.delete.v1`, with deduplication key `gift.delete.v1:{giftId}`.

  The deduplication key makes a repeated request enqueue nothing. After the transaction, the job
  dispatcher is woken as for publish.

**Routes.** `POST /api/gifts/{publicId}/pause`, `/resume` and `/delete` follow the publish route
order:

1. `validateJsonMutationRequest`;
2. `PublicGiftIdSchema`;
3. `enforceGiftMutationRateLimit(..., "gift-lifecycle")`;
4. a strict empty body of at most 1 KiB;
5. the service.

No `Idempotency-Key` header is needed, because every transition is idempotent by its state.

**Errors** map to:

- `404 NOT_FOUND`;
- `409 CONFLICT` with `details.reason` `GIFT_NOT_PUBLISHED` or `GIFT_EXPIRED`;
- `202` for delete, with `deletion: { status, requestedAt, purgeBy }`.

### 3. `gift.delete.v1`

`modules/gifts/application/gift-deletion.ts` holds the handler, with `maxAttempts: 8`. With the
backoff `min(2^n × 30 s, 1 h)` the attempts span about 2.5 hours, far inside the 24-hour promise.
Its ports:

- **`gifts.findDeleting(giftId)`**: the gift only while `deleting`. Anything else (purged, or never
  deleted) makes the run a no-op.
- **`assets.listUndeleted(giftId)`**, **`assets.markGiftAssetDeleting(assetId, giftId, now)`** and
  **`assets.markDeleted`**:
  - a conditional move from `initiated`, `uploaded`, `processing`, `ready` or `failed` to
    `deleting`, with `expiresAt` 60 seconds later;
  - assets already `deleting` are taken as they are.

  Storage deletes use `Promise.allSettled`, as in `gift.assets.cleanup.v1`. Any rejection keeps the
  asset `deleting` and throws `JobFailure("STORAGE_DELETE_FAILED", true)` after the loop. The media
  expired-asset sweep remains the safety net.

- **`records.deleteDerived(giftId, jobId)`**: `deleteMany` by `giftId` on `giftRevisions`,
  `giftPublications`, `previewTokens` and `idempotencyKeys`, and on `jobOutbox` for
  `payload.giftId` other than this job and not `processing`.
- **`analytics.deleteForGift(giftId)`**: `deleteMany({ giftRef })`, using the configured secret,
  through the new `analytics_events_gift_ref` index. With analytics disabled no events were
  stored, so it does nothing.
- **`gifts.purge({ gift, deletedAt, photos })`** runs in one transaction:
  1. upsert the tombstone, keyed by the gift id;
  2. `deleteOne` the gift with `status: "deleting"`;
  3. `insertAuditRecord` of `gift.deleted` (actor `system` / `gift.delete.v1`, metadata
     `{ photos, published }`, where `published` is whether the gift ever had a `publishedAt`).

  The upsert and the status filter make a repeat harmless.

`media.process.v1` jobs of the gift's assets are left alone: their handler already ends quietly for
an asset that is `deleting` or `deleted` (`media-processing` "Deleted asset job").

### 4. Studio

**Reads.** `getStudioGift` stays as it is, so a paused gift is not-found there. When it answers
`NOT_FOUND`, the Studio page asks `giftLifecycleService.findPaused(publicId, accessors)`. That read
returns `{ publicId, expiresAt, expired }`, only for the signed-in owner of a paused gift, and the
page then renders `PausedGiftPanel` instead of the editor.

**Client components** (`studio/gift-lifecycle-controls.tsx`):

- **`PauseGiftButton`** sits in `PublishedPanel`.
- **`DeleteGiftButton`** sits in the page's aside, for drafts and published gifts. It confirms with
  `window.confirm`, sends the request, and replaces the route with `/studio/deleted`. That is a
  static page with `Đã xoá món quà.` and `Tạo món quà mới`.
- **`PausedGiftPanel`** offers resume while not expired, and delete.

Pause and resume call `router.refresh()`, so the server decides which panel to show.

### 5. Admin lookup

`mongoAdminGiftLookup.findSummary` falls back to `giftTombstones`, with
`{ $or: [{ _id: q }, { publicId: q }] }`, when no gift matches. It returns a `{ kind: "deleted" }`
summary with the tombstone's fields only. `AdminGiftSummaryView` renders `Đã xoá` for it. The audit
treats it as a match: the target is the gift id.

### 6. Schema version 14

- **`giftTombstones`** gets:
  - a validator (fields of `gift-lifecycle` "Deletion purge job");
  - the index `gift_tombstones_public_id`;
  - the TTL index `gift_tombstones_expiry_ttl`.
- **`analyticsEvents`** gets the index `analytics_events_gift_ref`.
- **`apiRateLimits`** gets the scope `gift-lifecycle`.

There is no backfill.

## Risks / Trade-offs

- **A recipient with the envelope already open** keeps signed photo URLs for up to 300 seconds,
  until the job deletes the objects. This is accepted, and stated in the spec. The share link
  itself is dead at once.
- **A failed purge** leaves a `deleting` gift that nobody can reach. `pnpm jobs:dead` shows it, and
  `pnpm jobs:retry` re-runs it. Readiness reports the stall.
- **Analytics secret rotation** would orphan events stored under an old secret. Those expire
  through their 180-day TTL anyway.
- **Rollback past version 14:**
  - the previous build ignores `paused` and `deleting` gifts (it never serves them);
  - it does not run `gift.delete.v1`, so pending deletions wait until the roll forward;
  - `db:verify` reports drift.

## Migration Plan

1. Deploy, then run `pnpm db:migrate` and `pnpm db:verify`.
2. Run `pnpm jobs:deploy`; the `jobs-drain` and `jobs-sweep` tasks are unchanged and pick up the new
   type.
3. Smoke test:
   - pause and resume a test gift;
   - delete it, and check that `/g/{shareId}` answers `404`;
   - after the job, the admin lookup shows `Đã xoá`.
