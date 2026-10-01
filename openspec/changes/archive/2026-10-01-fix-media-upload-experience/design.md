# Design

## Context

Evidence from `love_memory_development` (read-only inspection, no gift text): three assets were
completed (jobs `pending`, attempts 0), never processed, and deleted by the creator about two
minutes later; their jobs stayed `pending`. Two new photos were completed afterwards. Minutes later
a worker run claimed the three stale jobs **one per run** (≈1 minute apart: each claim found a
`deleted` asset, marked the job `failed`, returned no claim, and `runNext` fell through to the
expired-upload cleanup and reported `idle`), and only then reached the two real jobs. This is the
head-of-line blocking in `mongoMediaWorkerRepository.claimNext` + `createMediaWorker().runNext`.

No worker ran on its own on `dev`: with `MEDIA_WORKER_MODE` unset and `NODE_ENV=production` the
mode is `trigger` (`media-processing` "Worker execution modes"), but no Trigger.dev deployment
consumed `media-worker-drain`/`media-worker-sweep` for that environment, and readiness only checks
that `TRIGGER_SECRET_KEY` is present (ADR-0008 keeps the outbox as the source of truth, so the work
was not lost — just not done).

The raw `The asset is not in a state that allows this operation.` is the `INVALID_STATE` → `409`
message of `media-route-handlers.ts`. The client shows any API message verbatim and never clears it,
so it stays on screen. Two client paths produce that `409` against an asset that is in fact fine:

1. **Duplicate delete.** The `Xóa` button is not disabled while its request runs. A second `DELETE`
   passes authorization while the asset is `deleting`, re-enters `deleting`, and its final
   `deleting → deleted` loses to the first request → `INVALID_STATE`. The three deletions in the
   evidence happened while the photos looked stuck, which is exactly when creators click twice.
2. **Late duplicate completion.** Completion is aborted by the client after 15 s and retried. On a
   cold function the first request can still be running; both read `initiated`, the first commits
   `uploaded`, and the second's `markUploadedAndEnqueue` returns `null` → `INVALID_STATE`, although
   the spec promises idempotent completion.

## Goals / Non-Goals

**Goals:** drains never stop at a stale job; completion is idempotent even under concurrency; the
Studio shows the creator's image and clear progress at every step, never English or raw server
text; a stalled worker is visible to operators through readiness and a log line.

**Non-Goals:** operating Trigger.dev/Vercel (runbook checklist only), cancelling jobs on delete,
readiness detection of stale `processing` leases, push-based status updates.

## Decisions

### 1. `discarded` worker outcome (ADR-0008)

`MediaWorkerRepository.claimNext` returns a third shape `{ discardedJobId }` when it marked a job
`failed` without processing (asset not claimable, or an exhausted stale lease whose asset already
left `processing`). `runNext` maps it to `{ status: "discarded" }` and `runAvailable` keeps looping
(the step counts toward the batch, so batches stay bounded and the drain continuation rule —
"a full batch of 10 schedules a `backlog` drain" — still applies). `scripts/media-worker.ts` prints
the new status; the Trigger.dev summary counts it. An exhausted asset keeps its existing
`{ exhaustedAsset }` shape (source deletion). Alternative rejected: looping inside `claimNext` —
it would hide the step from batch accounting and make one transaction unbounded.

### 2. Completion race → `202` (media-upload)

When `markUploadedAndEnqueue` (or `markFailed`) reports that the asset left `initiated`, the service
re-reads the asset and returns `success(dto)` for `uploaded`/`processing`/`ready`, `INVALID_STATE`
otherwise. Only the winning transaction inserted the job (it is conditional on `initiated`), so no
duplicate job is possible. The route still dispatches; dispatch is idempotent per asset and 10 s
window.

### 3. Studio field

- **Local preview.** After the grant succeeds, the field creates `URL.createObjectURL(croppedFile)`
  and keeps it in a ref map keyed by asset ID, mirrored in the item (`localPreviewUrl`). It is revoked
  when the item is removed (delete, interrupted upload, missing asset), when the item gets a
  derivative URL, and on unmount. It never leaves the browser, so CSP needs `img-src blob:` — already
  allowed for the crop dialog preview, so no CSP change.
- **Progress / processing UI.** Upload: a `role="progressbar"` bar with `aria-valuenow`, text
  `Đang tải lên {n}%`. Processing: overlay with a spinner (`motion-safe:animate-spin`) and
  `Đang xử lý ảnh…`. The status line is an `aria-live="polite"` region; progress percentages are not
  in it.
- **Slow hint.** A `pendingSince` map records when the field first saw an item `uploaded` or
  `processing`. The existing 1.5 s poll interval also recomputes the set of items pending for at
  least 45 s (`MEDIA_SLOW_PROCESSING_MILLISECONDS`), so the render stays pure and no extra timer runs.
- **In-flight guards.** `deletingAssetIds` and `retryingAssetIds` sets disable the buttons
  (`Đang xóa…`), mirroring the existing `completingAssetIds`.
- **Conflict-tolerant completion.** `requestUploadCompletion` throws a typed `MediaRequestError`
  (operation, status, code, retry-after flag). On `409` the field reads
  `GET /api/media/assets/{assetId}` and applies the outcome described in the spec. Delete `404` →
  remove item silently.
- **Error copy.** A pure module `media-error-messages.ts` exports `mediaErrorMessage(operation,
failure)` implementing the spec table; it is unit-tested per branch (presentation `.ts` coverage
  gate). `readApiError` is removed. Messages are cleared at the start of each creator action.

### 4. Readiness outbox check (health-checks)

`application/media-outbox-health.ts` defines the port `MediaOutboxMonitor { hasOverdueJob(cutoff) }`,
`MEDIA_OUTBOX_STALL_THRESHOLD_MILLISECONDS = 600_000`, `MediaOutboxStalledError` and
`assertMediaOutboxFlowing({ monitor, now })`. The Mongo adapter runs one `findOne` on `jobOutbox`
with `{ status: "pending", type: "media.process.v1", attempts: { $lt: 3 }, availableAt: { $lte:
cutoff } }`, projection `{ _id: 1 }` — served by the existing `job_outbox_available`
(`status`, `availableAt`) index; no migration. Composition exposes `checkMediaOutbox()`;
`/api/health/ready` calls it after `pingDatabase()`. Failures flow into the existing catch: generic
`503` body (`SERVICE_UNAVAILABLE`), `Cache-Control: no-store`, log `Readiness check failed` with
`errorName: "MediaOutboxStalledError"` — no identifiers. The route stays `force-dynamic`; no CSP or
caching change.

Threshold rationale: the sweep runs every 5 minutes and drains are dispatched on completion, so a
healthy `trigger` deployment never leaves a due job waiting 10 minutes. Future `availableAt` (retry
backoff) is excluded by the cutoff. In `inline` mode there is no sweep, so an overdue retry also
reports `503` until the next completion/retry or `pnpm media:work` — accurate (nothing will process
it) and documented in the runbook.

Alternative rejected: a separate `/api/health/media` endpoint (new route, new CSP/caching surface,
nobody polls it). Alternative rejected: a body field naming the failed dependency — forbidden by
"Safe readiness failure response".

### Authorization and data

No authorization change: the Studio still uses the owner-authorized media routes; readiness is
unauthenticated but returns nothing about jobs. No Zod contract, validator or index change.

## Risks / Trade-offs

- Readiness on `dev` turns `503` immediately after deploy while the old pending jobs exist and no
  worker runs. Intended: it is the signal that was missing. Smoke tests in the deployment runbook
  will fail until the worker is configured — the runbook says what to do.
- A readiness `503` from a stalled worker does not stop Vercel routing traffic; it is an operator
  signal, not a traffic gate.
- The slow hint is per page session: after a reload the 45 s count restarts.
- The local preview shows the crop even if processing later rejects the bytes; the failed state and
  its next-step text make that clear.
