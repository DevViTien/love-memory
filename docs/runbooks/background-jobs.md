# Background jobs runbook

Generic background jobs run retryable work after the request that caused it has committed. The
behavior is specified in `openspec/specs/background-jobs`, and the design is in
[architecture.md](../architecture.md#background-jobs). Image processing (`media.process.v1`) is a
separate pipeline with its own runbook, the [media pipeline runbook](./media-pipeline.md).

## Job types

| Type                     | Enqueued by                                                                     | Budget | What it does                                                                               |
| ------------------------ | ------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `gift.assets.cleanup.v1` | Each update of a published gift, and the schema version 12 backfill             | 5      | Deletes the detached photos of the gift that its current publication no longer references. |
| `gift.delete.v1`         | An owner deleting a gift (`gift-lifecycle`)                                     | 8      | Purges the gift: photo objects, derived records, analytics events; leaves a tombstone.     |
| `email.send.v1`          | A first publish, a final photo failure, a takedown, a payment (`system-emails`) | 6      | Emails the gift's current owner, with a Studio link and no gift content.                   |
| `publish.finalize.v1`    | A verified payment (`billing-checkout`)                                         | 6      | Publishes the paid order's gift and marks the order `fulfilled`.                           |
| `payment.reconcile.v1`   | Each checkout, due 2 minutes after its link expires                             | 6      | Reads the provider's verified status: applies a payment, or closes the order.              |

**Payloads.** A payload holds identifiers only (`{ giftId }`, plus `kind` and `eventKey` for
emails). Nothing in a job, a job log or the commands below contains gift content, addresses,
tokens or URLs.

**Trigger.dev variables for emails.** Besides the database and Blob variables, the Trigger.dev
environment of each tier needs `APP_URL`, `AUTH_EMAIL_FROM` and `RESEND_API_KEY` (the same values
as the Vercel tier). Without them, `email.send.v1` jobs fail with `EMAIL_SEND_FAILED` or
`JOB_FAILED` and end `dead`. Set the variables, then run `pnpm jobs:retry <jobId>` for each one.
Resend deduplicates a resend of the same email within 24 hours.

**Lifecycle.** `pending` → `processing` → `completed`. Two failure paths:

- **A retryable failure** returns the job to `pending` after a backoff: 60 s, 120 s, 240 s and so on,
  capped at 1 hour.
- **A permanent failure,** or the last attempt of the budget, moves it to `dead` with
  `lastErrorCode`.

A worker that crashed leaves a `processing` lease, which is claimed again after 10 minutes.

## Where jobs run

Generic jobs follow `MEDIA_WORKER_MODE`, the same mode as image processing.

- **`inline`** (local development and E2E). The request that enqueued the job runs up to 10 job steps
  after its commit. The local storage driver requires this mode.
- **`trigger`** (every Vercel tier). The request dispatches the Trigger.dev task `jobs-drain`.
  `jobs-sweep` runs every 5 minutes and catches anything a lost dispatch missed.

Both tasks live in `apps/web/src/trigger/jobs-worker.ts`. `pnpm jobs:deploy` deploys them together
with the media tasks, so run it for each tier after a deploy that changes `apps/web/src/trigger`
(see the [deployment runbook](./preview-deploy-and-rollback.md)).

## Operator commands

Run them with the tier's `MONGODB_URI` and `MONGODB_DATABASE`, never against a database you did not
mean to change.

| Command                   | Effect                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm jobs:work`          | Runs due jobs until none is left or 100 steps are handled, and prints one JSON line per step.                  |
| `pnpm jobs:dead`          | Lists up to 100 dead jobs, newest first: `id type attempts lastErrorCode updatedAt`.                           |
| `pnpm jobs:retry <jobId>` | Moves one dead job back to `pending` with a fresh budget. It refuses a job that is not dead, or an unknown id. |

## Triage

### Readiness answers `503` and the log names `JobOutboxStalledError`

A `pending` generic job has been due for more than 10 minutes, so no worker is running. Work through
these causes in order:

1. Check that the tier's Trigger.dev environment has the `jobs-drain` and `jobs-sweep` tasks
   deployed (`pnpm jobs:deploy`) and that `TRIGGER_SECRET_KEY` belongs to that environment.
2. Check the Trigger.dev dashboard for failing `jobs-sweep` runs.
3. As a stopgap, run `pnpm jobs:work` against the tier's database. Readiness recovers once nothing is
   overdue.

### A job is dead

1. Run `pnpm jobs:dead` and read the error code:
   - **`STORAGE_DELETE_FAILED`**: storage refused a deletion. The photo stays `deleting`, and the
     media expired-asset cleanup finishes it once storage works again. Retry the job after checking
     the Blob status.
   - **`PUBLICATION_UNREADABLE`**: the gift's current publication record is missing. This is a data
     integrity problem. Investigate before retrying; a retry cannot fix it.
   - **`INVALID_PAYLOAD`**: the job was written by a different release or by hand. Do not retry;
     record it.
   - **`LEASE_EXPIRED`**: a worker crashed on the job's last attempt. Retry it.
   - **`JOB_FAILED`**: an unexpected error. Correlate the job id with the `Job failed` log entries,
     fix the cause, then retry.
2. Run `pnpm jobs:retry <jobId>` once the cause is fixed. Handlers are idempotent, so a retry never
   repeats a side effect that already happened.

### A dead `gift.delete.v1`

The gift stays `deleting`. Nobody can open it, but its photos and content are not purged yet.

1. Read the `lastErrorCode` with `pnpm jobs:dead`. `STORAGE_DELETE_FAILED` means the object store
   refused a delete.
2. Fix the cause, then run `pnpm jobs:retry <jobId>`.

Every step is safe to repeat. The promise to the owner is a purge within 24 hours of the request,
so treat a dead deletion job as urgent.
