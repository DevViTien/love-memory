# Tasks

## 1. Pre-apply checks and sprint plan

- [x] 1.1 Confirm the starting point:
  - `pnpm openspec list` shows this change as the only active change;
  - `DATABASE_SCHEMA_VERSION` is `11`;
  - the code still has every symbol that design Context names: the `media.process.v1` type filters in `claimNext`, `retry` and `hasOverdueJob`; `assertMediaRuntimeReady`; `deleteAsset`; `runExpiredCleanup`; the update precondition in `publish`.

  Re-diff each MODIFIED block against the then-current `openspec/specs/`. Verify that `pnpm openspec validate add-job-outbox-dispatcher --strict` and `pnpm spec:check` pass with the one `modifiedBodyDrop` waiver of this change.

- [x] 1.2 Write `docs/sprints/sprint-6-plan.md`, covering:
  - the PO decisions of 2026-10-08: the outbox pulled forward, TOTP MFA for admins, admins granted by a CLI command with audit, and owner deletion that revokes at once and purges within 24 h;
  - the seven planned changes in dependency order;
  - the Sprint 4 and Sprint 5 dependencies and how each is handled;
  - the debt each change absorbs.

  In `docs/sprints/sprint-5-plan.md`, mark change 2 as moved to Sprint 6. Verify both documents link each other and plan.md §14–15.

## 2. Job runtime

- [x] 2.1 Add `apps/web/src/modules/jobs/application/job-registry.ts` (`JobHandler`, `JobFailure`, `JobOutboxRepository` port) and `job-runner.ts` (`createJobRunner`, design Decision 1). Verify `job-runner.test.ts` with a fake repository covers every scenario of `background-jobs` "Generic job claiming, retry and dead-letter":
  - completed;
  - retry with backoff (60 s after attempt 1, capped at 3600 s);
  - budget used up;
  - permanent failure;
  - crashed worker recovered and `LEASE_EXPIRED`;
  - `INVALID_PAYLOAD`;
  - `idle`;
  - a failure log that holds only id, type, attempts and code.
- [x] 2.2 Add `enqueueJob` to `packages/database` (design Decision 2). Add `modules/jobs/infrastructure/mongo-job-outbox.ts` implementing the port. Verify a repository test asserts:
  - the claim filter (`type: { $in }`, pending and due, or a stale lease) and its sort;
  - the `$setOnInsert` upsert;
  - the conditional `revive`;
  - the `listDead` projection without `payload`;
  - the `hasOverdueJob` filter and projection.
- [x] 2.3 Add `job-dispatcher.ts` (design Decision 3) and `composition/jobs.ts`, which registers the cleanup handler. Verify:
  - inline mode runs up to 10 steps;
  - trigger mode calls `tasks.trigger("jobs-drain")` with the windowed idempotency key;
  - a thrown error is reported and never rethrown.
- [x] 2.4 Add `apps/web/src/trigger/jobs-worker.ts` (`jobs-drain`, `jobs-sweep`; queue `jobs`, concurrency 1, 300 s, 3 retries, continuation on a full batch). Verify a unit test of its drain function covers the continuation and the summary log, mirroring the media worker's test if one exists. Otherwise test the extracted drain function.

## 3. Cleanup of detached assets

- [x] 3.1 Add `listDetachedReady` and `markDetachedDeleting` to `mongo-media-repository.ts` (design Decision 4). Verify repository tests assert both filters and the `$set`.
- [x] 3.2 Add `modules/media/application/gift-assets-cleanup.ts`. Verify `gift-assets-cleanup.test.ts` covers every scenario of `media-upload` "Cleanup of detached assets":
  - "Replaced photo deleted after the update";
  - "Photo still in the current publication";
  - "Storage removal fails" (`STORAGE_DELETE_FAILED`, the asset stays `deleting`);
  - "Gift gone".

  Also cover a second run that finds nothing, and an asset taken by another worker (the conditional write returns `false`).

## 4. Publish enqueue and readiness

- [x] 4.1 Make `publish` in `mongo-gift-repository.ts` enqueue the cleanup job for an update (design Decision 5), and make `publishGift` call the `jobs.dispatch` port after an update commits. Verify:
  - `mongo-gift-repository.test.ts` asserts the enqueue on update and none on a first publish;
  - `gift-service.test.ts` asserts that dispatch runs after a successful update only, and that a throwing dispatch still returns `201` ("Job failure does not fail the request").
- [x] 4.2 Add `job-outbox-health.ts` and call it from `/api/health/ready` (design Decision 6). Verify the readiness tests cover "Generic job worker stalled", "Generic retry is not a stall" and "Stalled job worker is named in the log".

## 5. Database schema version 12

- [x] 5.1 In `packages/database/src/migrations.ts`:
  - update the `jobOutbox` validator;
  - add `backfillDetachedAssetCleanupJobs` after `backfillLegacyEntitlements`;
  - set `DATABASE_SCHEMA_VERSION` to `12`.

  Verify that `migrations.test.ts` covers:
  - the validator;
  - "Cleanup jobs backfilled for detached photos" (one job, the right key, a second run adds nothing);
  - the version `12` mismatch message;
  - "Database not yet migrated to version 12".

- [x] 5.2 Run the migration in a throwaway database on a replica set (`MONGODB_DATABASE=love_memory_v12_check`), then drop it. Seed the version-11 state with:
  - a published gift at `publishedRevision` `7` with one detached `ready` asset;
  - a published gift without detached assets;
  - ledger `11`.

  Run `pnpm db:migrate`, `pnpm db:verify` and `pnpm db:migrate` again. Verify:
  - both migrate runs succeed and the ledger reads `12`;
  - exactly one `pending` cleanup job exists, keyed `…:7`;
  - MongoDB rejects a `jobOutbox` document with status `abandoned`.

  Record the run in this task.

- [x] 5.3 Extend `scripts/verify-gift-persistence.ts` (`db:verify-gifts`):
  - the update publish commits exactly one cleanup job for its revision, and a first publish commits none;
  - running that job through the real runner deletes the detached asset that the update no longer references (`deleted`);
  - the `explain` of `listDetachedReady` uses `assets_gift_field_created`.

  Run it in the throwaway database at version `12`, and verify `Gift persistence verification completed successfully.` with no residue.

## 6. Operator commands

- [x] 6.1 Add `scripts/jobs.ts` and the `jobs:work`, `jobs:dead` and `jobs:retry` scripts (design Decision 8). Verify, against the throwaway database, each scenario of "Operator job commands":
  - a dead job retried and then worked;
  - a live job refused with `Job is not dead: <id>`;
  - an unknown id refused with `Job not found: <id>`;
  - a listing without payload values.

  Record the run in this task. (Run on 2026-10-08 in `love_memory_v12_check`, then dropped.
  - `jobs:dead` listed one buried job as `id, type, 5, PUBLICATION_UNREADABLE, time`, with no `giftId`.
  - `jobs:retry <id>` printed `job_revived`. A second `jobs:retry` failed with `Job is not dead: <id>`, and an unknown id failed with `Job not found: <id>`.
  - `jobs:work` claimed the revived job with attempts `1` and returned it to `pending` with backoff.)

## 7. Documentation

- [x] 7.1 Write `docs/runbooks/background-jobs.md`, covering:
  - job types and budgets;
  - reading `jobs:dead`;
  - when to use `jobs:retry`;
  - `JobOutboxStalledError` triage;
  - deploying the Trigger.dev tasks.

  Update `docs/architecture.md` with a "Background jobs" section, and update the deployment runbook with schema version `12`, `jobs:deploy` after the migration, and the rollback note.

- [x] 7.2 Mark the risk-register row "Detached and superseded assets stay in Blob storage until cleanup" as mitigated for detached assets, and keep the superseded-publication text row open (Sprint 6 privacy change). Verify both rows reference this change.

## 8. End-to-end

- [x] 8.1 Extend the photo case of `apps/web/e2e/publish-update.spec.ts` (inline mode): after `Cập nhật món quà`, the replaced photo's asset is `deleted` in the E2E database, and the recipient receives the replacement. Verify that `pnpm test:e2e` passes on the production build.

## 9. Verification and archive

- [x] 9.1 Run `pnpm verify:local` and verify that it passes: secrets, specs, format, lint, types, coverage gates, audit, build and installed-Chrome E2E. If a part cannot run locally, record which part and why here. (2026-10-08. The first run stopped at the per-file function coverage of `job-registry.ts`, caused by an unused `registeredTypes` helper, which was removed. The second run passed every step: 1656 unit tests with the coverage gates, the build and installed-Chrome E2E 34/34. `pnpm test:e2e` (chromium, mobile-chromium) passed 68/68.)
- [x] 9.2 Archive with `pnpm openspec archive add-job-outbox-dispatcher --yes`, after diffing each MODIFIED block against `openspec/specs/`. Then:
  - remove this change's waiver from `openspec/gate-exceptions.json`;
  - check that `openspec/specs/background-jobs/spec.md` has its Purpose.

  Verify `pnpm spec:check` passes.

## Out of scope

- Moving `media.process.v1` onto the generic runtime.
- `gift.delete.v1` (gift deletion change), `email.send.v1` (Sprint 5 emails), `payment.reconcile` and `publish.finalize` (Sprint 5 payment), and `gift.expire` (waits for a retention policy).
- Deleting superseded publication records and their text (Sprint 6 privacy change).
- An admin screen for dead jobs and job dashboards (Sprint 6 admin change).
- A worker-mode variable separate from `MEDIA_WORKER_MODE`.
