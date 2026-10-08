# Design

## Context

For why this change exists and what it delivers, see proposal.md. The code it builds on, as it
stands at `01ecadb`:

- **The outbox collection.** `jobOutbox` already exists:
  - validator: `status` is `pending`, `processing`, `completed` or `failed`; `type` is any string;
  - indexes: `job_outbox_available` (`status`, `availableAt`) and the unique
    `job_outbox_deduplication`.
- **Media's use of it.** Only `mongo-media-repository.ts` writes it, with type `media.process.v1`.
  - `claimNext`, `retry` and `hasOverdueJob` all filter on that type, so other types can share the
    collection without being touched.
  - The media worker, its `MEDIA_WORKER_MODE` (`media-job-scheduler.ts`) and its Trigger.dev tasks
    (`trigger/media-worker.ts`) are specified in `media-processing`, and stay as they are.
- **Readiness.** `/api/health/ready` calls `assertMediaOutboxFlowing` with
  `mongoMediaOutboxMonitor.hasOverdueJob`, and logs `MediaOutboxStalledError`.
- **Deleting an asset.** `media-service.ts` `deleteAsset` does three steps:
  1. `markDeleting` (detach or `deleting`, atomically with the gift);
  2. remove the source and the derivatives;
  3. `markDeleted`.

  A `deleting` asset whose removal failed is finished by `media-worker.ts` `runExpiredCleanup`, one
  asset per idle worker step.

- **Detached assets.** They are `ready`, with `detachedAt` set and null slots. They can't be
  referenced by a save (`validateMediaReferences` filters `detachedAt: null`), so only the current
  publication can still reference them.
- **The publish transaction.** `mongo-gift-repository.ts` `publish` runs one transaction. Its
  update branch is the precondition `status: "published"`.

The governing ADRs are ADR-0008 (Trigger.dev; the outbox is the durable handoff; ids-only payloads;
idempotency, retry, timeout and recovery for every job) and ADR-0001 (modular monolith; adapters
wired only in composition).

## Goals / Non-Goals

**Goals:**

- One generic runner whose handlers stay small and idempotent. Adding `gift.delete.v1` or
  `email.send.v1` later means registering a handler, nothing else.
- No change at all to the specified media pipeline.
- A dead-letter path that operators can inspect and retry without touching MongoDB by hand.

**Non-Goals:**

- Priorities, per-type queues and concurrency above 1. The volume is tiny at MVP scale.
- A generic `failed` status. Generic jobs use `dead`; `failed` stays media's.

## Decisions

### 1. A separate runner in `modules/jobs`, sharing only the collection with media

`apps/web/src/modules/jobs/application/job-runner.ts` exports `createJobRunner`, with this API:

- **Dependencies:** `{ repository, handlers, clock, log }`.
- **`runStep()`.** Claims one job and runs it. It returns `{ id, type, outcome }`, where `outcome`
  is `completed`, `retrying`, `dead` or `idle`.
- **`runAvailable(limit)`.** Runs steps until one reports `idle` or `limit` is reached.

`job-registry.ts` defines the handler contract:

```ts
export type JobHandler<P> = Readonly<{
  type: `${string}.v${number}`;
  maxAttempts: number;
  payload: z.ZodType<P>;
  run: (payload: P, context: Readonly<{ jobId: string; now: Date }>) => Promise<void>;
}>;
export class JobFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}
```

`JobOutboxRepository` (port) has these methods:

- `claimNext(types, now)`;
- `complete(id, now)`;
- `retryLater(id, code, availableAt, now)`;
- `markDead(id, code, now)`;
- `listDead(limit)`;
- `revive(id, now)`;
- `hasOverdueJob(types, cutoff)`.

`mongo-job-outbox.ts` implements it.

- **Claiming.** `claimNext` is one `findOneAndUpdate` with this filter:

  ```js
  { type: { $in: types }, $or: [
      { status: "pending", availableAt: { $lte: now } },
      { status: "processing", updatedAt: { $lte: now - 10 min } } ] }
  ```

  It sorts on `availableAt` then `createdAt`, applies `$inc: { attempts: 1 }` and
  `$set: { status: "processing" }`, and returns the document. No transaction is needed: the job
  document is the only thing changed.

- **Stale leases out of budget.** The runner then sees `attempts > maxAttempts` (it only reaches
  that through a crash) and marks the job `dead` with `LEASE_EXPIRED`.
- **Why not reuse media's claim.** Media's claim is coupled to asset status inside a transaction
  (`media-processing`). Generalizing it would change a specified, verified pipeline for no gain.

Backoff is `min(2^attempts × 30 s, 3600 s)`. Unknown errors become `JobFailure("JOB_FAILED", true)`.
The log helper writes `{ event: "job_failed", jobId, type, attempts, code }` and nothing else.

### 2. Enqueue helper and deduplication

`enqueueJob(database, session, { type, payload, deduplicationKey, now })` lives in `packages/database`
beside the collection names, because both the gift repository and the migration use it. It does an
`updateOne({ deduplicationKey }, { $setOnInsert: {...} }, { upsert: true, session })`:

- the unique index makes a duplicate a no-op, not an error;
- inside the transaction, the insert commits or aborts with its cause.

A concurrent duplicate upsert could still raise `E11000`. That is only possible for the same
gift's same revision, which the publish transaction already serializes on the gift document.

### 3. Dispatch follows `MEDIA_WORKER_MODE`

`modules/jobs/infrastructure/job-dispatcher.ts` exports `dispatchJobs(type)`:

- **Mode.** It reuses `assertMediaRuntimeReady(process.env)` to pick the mode. A single variable
  keeps a deployment from mixing modes. The local storage driver already forces `inline`, and the
  cleanup handler deletes objects through the same storage driver, so inline is required locally
  anyway.
- **`inline`.** It imports `@/composition/jobs` lazily and awaits `runAvailable(10)`.
- **`trigger`.** It calls `tasks.trigger("jobs-drain", {}, { idempotencyKey })`. The key is
  `jobs-drain:{type}:{10 s window}`, global, with a TTL of 1 minute.
- **Errors.** Every error is caught and reported through `reportOperationalFailure("jobs_dispatch",
…)`. Dispatch never fails the caller.

`composition/gifts.ts` gives the gift service a `jobs.dispatch` port. `publishGift` calls it after an
update commits (`outcome.status === "published" && isUpdate`), before it returns.

`trigger/jobs-worker.ts` mirrors `media-worker.ts`:

- `jobsDrainTask` (`jobs-drain`) runs a batch of 10 and triggers a continuation on a full batch;
- `jobsSweepTask` (`jobs-sweep`) runs on cron `*/5 * * * *`;
- both use the `jobs` queue with concurrency 1, `maxDuration` 300 and 3 retries.

`trigger.config.ts` already scans `./src/trigger`.

### 4. The cleanup handler reuses the user-delete steps

The handler is `modules/media/application/gift-assets-cleanup.ts`, type `gift.assets.cleanup.v1`,
with `maxAttempts` 5. It needs these ports:

- `gifts.findEditableById(giftId)`: a `published` gift, or nothing to do;
- `publications.findByGiftRevision(giftId, publishedRevision)`;
- `assets.listDetachedReady(giftId)`;
- `assets.markDetachedDeleting(assetId, giftId, now)`;
- `assets.markDeleted(assetId, now)`;
- `storage.deleteObject`.

The steps:

1. **Select.** Take the assets from `listDetachedReady` whose id is not in the current publication's
   `assetIds`.
2. **Claim each one.** `markDetachedDeleting` is a conditional `updateOne` with the filter
   `{ _id, giftId, status: "ready", detachedAt: { $ne: null } }`. It sets `status: "deleting"` and
   `expiresAt: now + 60 s`. `false` means another worker took it, so the handler skips it.
3. **Remove the objects** with `Promise.allSettled` over the source and the derivatives (the same as
   `deleteAsset`). A rejection leaves that asset `deleting` (with its 60 s expiry, so
   `runExpiredCleanup` finishes it). The handler continues with the other assets, then throws
   `JobFailure("STORAGE_DELETE_FAILED", true)`. A missing current publication throws
   `JobFailure("PUBLICATION_UNREADABLE", true)` before anything changes.
4. **Mark `deleted`.**

Why this is safe:

- **No later publication can need the asset.** A detached asset can never be referenced again: the
  save validation excludes it, and a publish confirms only non-detached assets. So once the current
  publication doesn't reference it, no later publication can.
- **The selection can't go stale.** The current publication is read before the write, and a newer
  publication can only reference fewer detached assets.
- **Reruns are no-ops.** Running the job again selects nothing.

`listDetachedReady` filters on `giftId`, `status: "ready"` and `detachedAt: { $ne: null }`.
`assets_gift_field_created` (prefix `giftId`) serves it with a small residual filter, so no index is
added. `db:verify-gifts` asserts the plan with `explain`.

### 5. The publish transaction enqueues the job

In `mongo-gift-repository.ts` `publish`, after the publication insert and when
`precondition.status === "published"`, the transaction runs `enqueueJob` with:

- type `gift.assets.cleanup.v1`;
- payload `{ giftId }`;
- the deduplication key `gift.assets.cleanup.v1:{giftId}:{revision}`.

A first publish has no detached assets, so it enqueues nothing.

### 6. Readiness

`modules/jobs/application/job-outbox-health.ts` adds `assertJobOutboxFlowing` and
`JobOutboxStalledError`, using `hasOverdueJob(REGISTERED_TYPES, cutoff)`:

- the filter is `{ status: "pending", availableAt: { $lte: cutoff }, type: { $in: types } }`, with
  `projection: { _id: 1 }`;
- it is served by `job_outbox_available`.

`app/api/health/ready/route.ts` calls it right after the media check, and the readiness test covers
both errors.

### 7. Schema version `12`

- **Validator.** The `jobOutbox` `status` enum gains `dead`, and `lastErrorCode` is
  `["string", "null"]`.
- **Backfill.** `backfillDetachedAssetCleanupJobs` runs after the entitlement backfill:
  1. aggregate `assets` with `$match: { detachedAt: { $ne: null }, status: "ready" }` and
     `$group: { _id: "$giftId" }`;
  2. find those gifts with `status: "published"`;
  3. call `enqueueJob` for each, without a session, keyed by `publishedRevision`.

  The deduplication key makes reruns no-ops.

- **No new index** (Decision 4 names the serving index).

### 8. Operator commands

`scripts/jobs.ts` takes `work`, `dead` or `retry <id>`, mirroring `scripts/database.ts`:
`--env-file-if-exists`, `react-server` conditions, and the client closed in `finally`.

- **`work`** composes the runner through `@/composition/jobs` (the same handlers as production).
- **`dead`** prints tab-separated `id type attempts lastErrorCode updatedAt`.
- **`retry`** calls `revive`, a conditional `updateOne` with the filter `{ _id, status: "dead" }`
  and `$set: { status: "pending", attempts: 0, availableAt: now }`. When nothing matches, it looks
  the job up to pick the right error (`Job not found` or `Job is not dead`).

`package.json` gains `jobs:work`, `jobs:dead` and `jobs:retry`.

## Risks / Trade-offs

- **The deploy needs the new Trigger.dev tasks.** Without `pnpm jobs:deploy`, `jobs-drain` dispatches
  fail (logged, never fatal), and nothing runs the jobs until the tasks exist. Readiness then reports
  `JobOutboxStalledError` within 10 minutes. → The deployment runbook gains the step. The tasks are
  deployed with the existing `jobs:deploy` script, which already deploys the whole `src/trigger`
  folder.
- **Cleanup permanently deletes photos.** A bug in the selection would delete a photo a recipient
  needs. → Unit tests pin the selection, including "detached but still current". `db:verify-gifts`
  exercises the real sequence (detach, update, cleanup) on a replica set, and the E2E journey checks
  that the recipient still sees the new photo and the old one is gone.
- **Inline work lengthens the update request** by the cleanup of a few objects in development. →
  Accepted; Production uses `trigger`.
- **Shared collection.** A malformed generic job can't block media, because the claims are filtered
  by type. Media health and generic health are separate errors.
- **Rollback to schema version `11`.** The previous build's validator rejects `dead` documents
  (collMod replaces the validator), so old code writing jobs is unaffected. Its `db:verify` reports
  drift. Generic jobs stay in the collection, and nothing runs them until a roll forward. Media is
  unaffected. → The runbook gains a short note; no data repair is needed.

## Migration Plan

1. Merge to `dev`, push, and wait for `Ready`. Run `pnpm db:migrate`, `pnpm db:verify` and
   `pnpm db:verify-gifts` against the tier, then `pnpm jobs:deploy` for that tier's Trigger.dev
   environment.
2. Smoke test: on a published test gift, remove a photo, add another, and update. Within 5 minutes
   the old photo's asset is `deleted`. `pnpm jobs:dead` lists nothing, and readiness stays `200`.
3. Promote to `stg` with the same steps.
