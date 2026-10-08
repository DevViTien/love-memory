# Proposal

## Why

Only image processing runs in the background today. `media.process.v1` has its own worker, its own
claim rules and its own Trigger.dev tasks. Every other piece of retryable work in the plan needs a
general way to run idempotent jobs after a request commits, plus a way for operators to see and
retry jobs that keep failing:

- asset cleanup;
- gift deletion;
- system email;
- payment fulfillment.

Sprint 6 (plan.md §15) cannot start without it. Deleting a gift (Gate M5: "Deletion flow runs end
to end on staging") is long-running work that the invariants forbid inside a request. The Product
Owner therefore decided on 2026-10-08 to pull Sprint 5's job outbox change (plan.md §14.4) forward
as the first Sprint 6 change. Email, checkout and the payment webhook stay in Sprint 5.

The runtime needs a real first consumer to prove it. The risk register's "Detached and superseded
assets stay in Blob storage until cleanup" is that consumer. A photo removed from a published gift
is only detached, so recipients keep seeing it. Once an update publishes a revision without it, no
served publication needs it, yet nothing ever deletes it.

## What Changes

- **A generic job runtime on the existing `jobOutbox`.**
  - **Handlers.** Each job type registers a handler, a payload schema and an attempt budget. Payloads
    hold identifiers only.
  - **Claiming.** A worker step claims the oldest available job of a registered type
    (`media.process.v1` keeps its own worker and rules unchanged). It runs the handler and marks the
    job `completed`.
  - **Failure.** A retryable failure returns the job to `pending` with exponential backoff. A
    permanent failure, or the last allowed attempt, moves it to the new status `dead` with a
    `lastErrorCode`.
  - **Stale leases.** A lease left `processing` for 10 minutes is claimed again.
- **Dispatch through the existing worker mode** (`MEDIA_WORKER_MODE`).
  - `inline` runs up to 10 job steps after the transaction that enqueued work commits. A job failure
    never changes that request's response.
  - `trigger` dispatches the new Trigger.dev task `jobs-drain`. The cron task `jobs-sweep`, every 5
    minutes, picks up anything a lost dispatch left behind.
- **Operator commands.**
  - `pnpm jobs:work` drains available jobs.
  - `pnpm jobs:dead` lists dead jobs (id, type, attempts, error code, time; never payload values).
  - `pnpm jobs:retry <jobId>` returns a dead job to `pending` with a fresh attempt budget.
- **Readiness.** `GET /api/health/ready` also fails when a generic job has been overdue for more than
  10 minutes. The log names `JobOutboxStalledError`, and the response stays generic.
- **First consumer: `gift.assets.cleanup.v1`.**
  - **Enqueue.** Every update of a published gift enqueues one job for the gift in the publish
    transaction (deduplicated per gift and revision).
  - **Effect.** The handler deletes every detached asset of the gift that the current publication
    no longer references, the same way a user deletion does: move it to `deleting`, remove its
    storage objects, and mark it `deleted`. If a removal fails, the job retries, and the existing
    media expired-asset cleanup finishes whatever is left in `deleting`.
  - **Safety.** A detached asset can never re-enter the working copy, so nothing a recipient can
    receive is ever removed.
- **Database schema version `12`.**
  - **Validator.** The `jobOutbox` validator allows `dead` and an optional `lastErrorCode`.
  - **Backfill.** `db:migrate` enqueues one cleanup job for each published gift that already has
    detached assets.

This change belongs to **Sprint 6, Gate M5**. It is pulled forward from Sprint 5 (plan.md §14.4,
Gate M4) by the PO decision recorded in `docs/sprints/sprint-6-plan.md`. It is the first Sprint 6
change; gift deletion, takedown and the later email and payment work all use it.

## Non-goals

- **Moving `media.process.v1` onto the generic runtime.** Its claim rules, attempt budget, failure
  codes and Trigger.dev tasks are specified in `media-processing` and stay exactly as they are. It
  only shares the collection.
- **Job types other than `gift.assets.cleanup.v1`.**
  - `gift.delete` comes with the gift-deletion change.
  - `email.send` comes with Sprint 5's email change.
  - `payment.reconcile` and `publish.finalize` come with Sprint 5's payment changes.
  - `gift.expire` waits for a retention policy; expiry is already enforced by server time.
- **Deleting superseded publication records or their text.** That is a privacy and retention
  decision for the Sprint 6 privacy change. Only the photos no served publication references are
  removed here.
- **An admin screen for dead jobs and job dashboards** (Sprint 6 admin change; plan.md §17.7 P1).
  Operators use the commands until then.
- **A separate worker-mode variable.** Generic jobs follow `MEDIA_WORKER_MODE`, so one deployment
  never mixes inline and Trigger.dev workers.

## Invariants touched

- **Long-running or retryable work goes through the outbox and background jobs, never a request.**
  This is what the change makes possible. Jobs are inserted in the same transaction as the state
  that needs them. The outbox stays the source of truth, and a lost dispatch is recovered by the
  sweep. In `inline` mode the work runs after the commit, as `media-processing` already does for
  development.
- **Job payloads hold identifiers only** (ADR-0008). `gift.assets.cleanup.v1` carries `giftId`.
  Operator listings and logs show ids, types, counts and error codes, never payload values or
  content.
- **Storage keys never reach the browser; no image bytes in MongoDB.** Unchanged. Cleanup only
  changes asset status, and the existing worker deletes objects by stored key.
- **Recipients keep what a served publication references.** Cleanup touches only assets that are
  detached and absent from the current publication's `assetIds`. A detached asset can no longer be
  referenced by a save, so a later publication can never need it again.
- **Authorize inside the data-access filter.** No new route. The commands are operator tools that
  run with database credentials.
- **Never log gift text, tokens or signed URLs.** Job logs carry the job id, type, attempt count and
  error code only.

## Capabilities

### New Capabilities

- `background-jobs`: generic job records, claiming, retry and dead-letter, dispatch and worker
  modes, the `jobs-drain` and `jobs-sweep` tasks, and the operator commands.

### Modified Capabilities

- `gift-publishing`: an update's publish transaction also enqueues `gift.assets.cleanup.v1`
  (requirement "Immutable publication snapshot").
- `media-upload`: a new requirement for the cleanup of detached assets that no current publication
  references.
- `health-checks`: readiness covers stalled generic jobs (`JobOutboxStalledError`).
- `database-schema-management`:
  - the `jobOutbox` validator allows `dead` and `lastErrorCode`;
  - schema version `12` with the cleanup-job backfill;
  - `db:verify-gifts` covers the enqueue.

## Impact

- **Application:**
  - new `apps/web/src/modules/jobs/` (`application/job-runner.ts`, `job-registry.ts`,
    `job-outbox-health.ts`; `infrastructure/mongo-job-outbox.ts`, `job-dispatcher.ts`);
  - a `gift-assets-cleanup` handler in `modules/media/application`.
- **Composition:** `composition/jobs.ts` wires the handlers, the repository and the dispatcher;
  `composition/gifts.ts` dispatches after an update publish.
- **Trigger.dev:** `apps/web/src/trigger/jobs-worker.ts` (`jobs-drain`, `jobs-sweep`).
- **Persistence:**
  - `mongo-gift-repository.ts` `publish` inserts the job in its transaction;
  - `mongo-media-repository.ts` gains the conditional move of detached assets to `deleting`.
- **Database:** `packages/database/src/migrations.ts` moves to version `12`.
- **Health:** `/api/health/ready` adds the generic outbox check.
- **Scripts and tests:**
  - `scripts/jobs.ts` (`jobs:work`, `jobs:dead`, `jobs:retry`) and `package.json`;
  - `scripts/verify-gift-persistence.ts` (`db:verify-gifts`).
- **E2E:** `publish-update.spec.ts` checks that a replaced photo of a published gift ends `deleted`
  after the update.
- **Docs:**
  - `docs/sprints/sprint-6-plan.md` (new) and a note in `docs/sprints/sprint-5-plan.md`;
  - `docs/architecture.md` (background jobs);
  - a new `docs/runbooks/background-jobs.md` (dead jobs, retry, stalls);
  - the deployment runbook (schema version `12`; deploy the Trigger.dev tasks);
  - the risk register (the detached-assets row is mitigated).
- **No new dependency, route or environment variable.**
