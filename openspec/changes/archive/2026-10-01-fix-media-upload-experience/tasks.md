# Tasks

## 1. Worker head-of-line fix

- [x] 1.1 Return `{ discardedJobId }` from `mongoMediaWorkerRepository.claimNext` when a job is
      marked `failed` without processing (unclaimable asset, exhausted lease whose asset left
      `processing`), with repository tests for both paths and the rolled-back-attempt reset
- [x] 1.2 Map it to the `discarded` outcome in `runNext`, keep `runAvailable` looping, and add worker
      tests: a discarded step is not `idle`, and a drain processes the real job behind a stale one
- [x] 1.3 Report `discarded` in `scripts/media-worker.ts` and the Trigger.dev drain summary (both
      print the step status generically), and prove the discard path and the outbox monitor against
      a real MongoDB in `scripts/verify-media-persistence.ts` (run on `love_memory_e2e`)

## 2. Idempotent completion

- [x] 2.1 Re-read the asset when `markUploadedAndEnqueue` or `markFailed` reports a lost race and
      return the DTO for `uploaded`/`processing`/`ready`, with service tests for both outcomes

## 3. Studio image field

- [x] 3.1 Add `media-error-messages.ts` (operation × status/code → Vietnamese copy) with unit tests
      for every branch, and replace `readApiError` and English fallbacks in the field and crop dialog
- [x] 3.2 Show the cropped image as a local object URL preview during upload and processing, revoke
      it on removal, on derivative swap and on unmount, with component tests
- [x] 3.3 Render the upload progress bar, the processing overlay with spinner and `Đang xử lý ảnh…`,
      the polite live status region and the failed next-step text, with component tests
- [x] 3.4 Show the 45-second slow-processing hint from the polling tick, with a fake-timer test
- [x] 3.5 Treat a completion `409` as "read the asset" and a delete `404` as "already gone", with
      regression tests (late duplicate completion, failed asset on conflict, asset gone)
- [x] 3.6 Disable delete (`Đang xóa…`) and retry while their requests run and clear messages when
      an action starts, with tests (double click sends one `DELETE`, old message cleared)

## 4. Stalled worker observability

- [x] 4.1 Add `media-outbox-health.ts` (port, threshold, `MediaOutboxStalledError`,
      `assertMediaOutboxFlowing`) with unit tests, and the Mongo `hasOverdueJob` adapter with a
      repository test of the exact filter and projection
- [x] 4.2 Wire `checkMediaOutbox()` in `composition/media.ts` and call it from
      `/api/health/ready` after the ping, with route tests (stalled → `503` generic body and
      `MediaOutboxStalledError` log; healthy → `200`)
- [x] 4.3 Document stalled-worker detection, the inline option for `dev`, and the Trigger.dev
      checklist in `docs/runbooks/media-pipeline.md`; add the worker variables to the environment
      table in `docs/runbooks/preview-deploy-and-rollback.md`

## 5. End-to-end

- [x] 5.1 Extend `apps/web/e2e/media-upload.spec.ts`: local `blob:` thumbnail and progress bar while
      the `PUT` is held, `Đang xử lý ảnh…` overlay while processing is held, ready derivative swap,
      and a late duplicate completion (`409`) that shows no error and no English text

## 6. Verification and archive

- [x] 6.1 Run the narrow Vitest suites, `pnpm test:e2e` and `pnpm test:e2e:chrome`
- [x] 6.2 Run `pnpm verify:local`
- [x] 6.3 Archive this change in the same PR and confirm `node --import tsx scripts/check-openspec.ts`
      passes

## Out of scope

- Configuring Trigger.dev and Vercel environment variables for `dev`, `stg` and production
  (operator task; checklist in the runbook).
- Cancelling pending outbox jobs when a creator deletes an asset.
- Readiness detection of stale `processing` leases and exhausted retries.
- Server-side idempotency of concurrent deletes (the Studio prevents duplicate deletes instead).
- Push-based (SSE/WebSocket) status updates instead of polling.
