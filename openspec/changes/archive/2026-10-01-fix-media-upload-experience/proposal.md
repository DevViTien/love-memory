# Proposal

## Why

On the deployed `dev` environment, uploaded photos stayed as grey boxes reading `Đang tải 100%` /
`Đang xử lý` forever, the preview showed no photos, and the Studio eventually printed the raw English
server message `The asset is not in a state that allows this operation.` Inspection showed three
separate problems behind one bad experience: no media worker ran on `dev` (Trigger.dev was not
deployed and nothing reported it), the worker stops a drain early when the oldest job belongs to an
asset that was deleted in the meantime, and the Studio image field gives almost no feedback and shows
raw server text for any refused request. This is a Sprint 3 / Gate M2 follow-up: the vertical-slice
demo (create → upload → preview → publish) depends on uploads visibly finishing.

## What Changes

- **Worker head-of-line fix**: when the claimed job's asset can no longer be processed (for example it
  was deleted), the job is still marked `failed`, but the worker step now reports it as handled
  (`discarded`) instead of "nothing to do", so inline drains, Trigger.dev drains and
  `pnpm media:work` continue with the jobs behind it.
- **Idempotent completion under concurrency**: a completion request that loses the race to another
  completion of the same asset answers `202` with the current DTO instead of `409`, matching the
  existing idempotency rule. The Studio also treats a `409` on completion as "refresh this asset"
  rather than an error.
- **Studio upload feedback**: the cropped image is shown immediately as the item's thumbnail while it
  uploads and while it is processed; uploads show a progress bar; processing shows a spinner overlay
  with `Đang xử lý ảnh…`; after 45 seconds of processing a calm hint explains that the image will
  update by itself; the signed derivative replaces the local image when ready. Delete and retry
  actions are disabled while their request runs, so a double click cannot produce a conflict.
- **Vietnamese error copy**: the field maps every API error code (per operation) to Vietnamese copy
  and never shows a raw server message. A refused delete whose asset is already gone removes the item
  silently. Old messages are cleared when the creator starts a new action.
- **Observable stalled worker**: `GET /api/health/ready` also answers the generic `503` when a
  claimable `media.process.v1` job has been waiting for more than 10 minutes, logging the safe error
  name `MediaOutboxStalledError`. The media pipeline runbook documents this, the inline option for
  `dev`, and a Trigger.dev checklist for `dev`/`stg`/production.

## Non-goals

- Deploying or configuring Trigger.dev or Vercel environment variables (an operator task; the
  runbook gives the exact checklist).
- Cancelling outbox jobs at user-delete time; stale jobs are now discarded by the worker without
  blocking others.
- Detecting stale `processing` leases or exhausted retries in readiness; only overdue `pending`
  work is reported.
- Server-side changes to delete conflicts; the Studio guards against duplicate deletes instead.
- Push updates (SSE/WebSocket) instead of 1.5-second polling.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `media-processing`: a job whose asset cannot be claimed is a handled worker step that does not end
  a drain.
- `media-upload`: completion that loses a race to another completion answers `202`.
- `studio-image-list-field`: local thumbnail, progress bar, processing overlay, slow-processing
  hint, in-flight guards, Vietnamese error messages and conflict-tolerant completion and delete.
- `health-checks`: readiness reports an overdue media outbox job as not ready.

## Invariants touched

- Long-running work through the outbox: unchanged; readiness only reads one outbox job, and the
  drain fix makes the outbox drain more reliably.
- Storage keys and raw Blob URLs never reach the browser: the local thumbnail is a browser object URL
  of the creator's own cropped file, never uploaded or stored; derivatives are still signed URLs.
- Never log gift text, tokens or signed URLs: the readiness log carries only an error name and the
  request id; the readiness body stays generic.
- No image bytes in MongoDB: unchanged.

## Impact

- Code: `apps/web/src/modules/media/{application/media-worker,application/media-service,
infrastructure/mongo-media-repository}.ts`, new `application/media-outbox-health.ts`,
  `presentation/media-image-list-field.tsx`, new `presentation/media-error-messages.ts`,
  `composition/media.ts`, `app/api/health/ready/route.ts`, `trigger/media-worker.ts`,
  `scripts/media-worker.ts`, `scripts/verify-media-persistence.ts`, `apps/web/e2e/media-upload.spec.ts`.
- Docs: `docs/runbooks/media-pipeline.md`, `docs/runbooks/preview-deploy-and-rollback.md`.
- No migration (the existing `job_outbox_available` index serves the readiness read), no new
  environment variable, no new route.
