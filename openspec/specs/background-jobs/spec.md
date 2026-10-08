# background-jobs Specification

## Purpose

Runs retryable work after the request that caused it has committed: generic jobs stored in the job
outbox, how workers claim, retry and give up on them, how they are dispatched, and the commands
operators use to see and retry jobs that keep failing.

## Requirements

### Requirement: Generic job records

The system SHALL record background work other than `media.process.v1` as generic jobs in the job
outbox. A generic job SHALL hold:

- `_id`, a UUID;
- `type`, a registered job type with a version suffix (for example `gift.assets.cleanup.v1`);
- `payload`, an object that holds identifiers only, never gift content, tokens or URLs;
- `status`: `pending`, `processing`, `completed` or `dead`;
- `attempts`, starting at `0`;
- `availableAt`;
- `deduplicationKey`, unique across the outbox;
- `lastErrorCode`, `null` until a failure;
- `createdAt` and `updatedAt`.

A job SHALL be inserted in the same database transaction as the state change that requires it, so
that both commit or neither does. Inserting a job whose `deduplicationKey` already exists SHALL
insert nothing and SHALL NOT fail the transaction. The registered generic job types are exactly
those listed by the requirements that define them; this change registers `gift.assets.cleanup.v1`
(`media-upload` "Cleanup of detached assets") with an attempt budget of `5`. `media.process.v1`
SHALL keep its own records, claiming and statuses (`media-processing`), and no generic worker SHALL
ever claim it.

#### Scenario: Job committed with its cause

- **WHEN** the transaction that inserts a job aborts
- **THEN** no job exists, and neither does the state change it was inserted with

#### Scenario: Duplicate enqueue

- **WHEN** a job is enqueued twice with the same `deduplicationKey`
- **THEN** exactly one job exists, and the second enqueue does not fail its transaction

#### Scenario: Media jobs are left alone

- **WHEN** a generic worker step runs while only `pending` `media.process.v1` jobs are available
- **THEN** it claims nothing, and those jobs are unchanged

### Requirement: Generic job claiming, retry and dead-letter

A worker step SHALL claim the oldest available generic job (by `availableAt`, then `createdAt`) of a
registered type that is either `pending` with `availableAt` at or before now, or `processing` with no
update for at least 10 minutes (a stale lease). Claiming SHALL atomically increment `attempts` and
set `status` to `processing`. A stale lease whose job has already used its whole attempt budget SHALL
become `dead` with `lastErrorCode` `LEASE_EXPIRED`, without running the handler again.

After claiming, the step SHALL validate the payload against the type's schema. An invalid payload
SHALL make the job `dead` with `lastErrorCode` `INVALID_PAYLOAD`, without running the handler. The
step SHALL then run the type's handler, which MUST be idempotent:

- **Success.** The job SHALL become `completed`, with `lastErrorCode` `null`.
- **Retryable failure.** This means a failure the handler marks retryable, or any unexpected error,
  which is recorded as `JOB_FAILED`. While `attempts` is below the type's budget, the job SHALL
  return to `pending` with that `lastErrorCode` and `availableAt` delayed by 2^attempts × 30 seconds,
  at most 3600 seconds. When the budget is used up, the job SHALL become `dead`.
- **Permanent failure.** The job SHALL become `dead` with the handler's error code, whatever its
  attempts.

A worker step that finds no claimable job SHALL report `idle`. Each failure SHALL be logged as `Job
failed` with only the job id, type, attempts and error code, never the payload, an error message or
gift content.

#### Scenario: Retry with backoff

- **WHEN** a `gift.assets.cleanup.v1` job fails with a retryable error on its first attempt
- **THEN** the job is `pending` with `lastErrorCode` set and `availableAt` 60 seconds after the failure

#### Scenario: Budget used up

- **WHEN** the same job fails with a retryable error on its fifth attempt
- **THEN** the job is `dead`, and no worker claims it again

#### Scenario: Permanent failure

- **WHEN** a handler reports a permanent failure on the first attempt
- **THEN** the job is `dead` with that error code after one attempt

#### Scenario: Crashed worker recovered

- **WHEN** a job has been `processing` for 10 minutes without update and has attempts left
- **THEN** the next worker step claims it again and runs the handler

#### Scenario: Malformed payload

- **WHEN** a `gift.assets.cleanup.v1` job's payload has no `giftId`
- **THEN** the job becomes `dead` with `lastErrorCode` `INVALID_PAYLOAD`, and the handler is not run

#### Scenario: Failure log holds no content

- **WHEN** a job fails
- **THEN** the log entry `Job failed` holds the job id, type, attempts and error code, and no payload value

### Requirement: Generic job dispatch and worker modes

Generic jobs SHALL use the worker mode of `media-processing` ("Worker execution modes"), chosen by
`MEDIA_WORKER_MODE`.

- **`inline` mode.** After a request's transaction that inserted generic jobs commits, the request
  SHALL run up to 10 generic worker steps before it responds.
- **`trigger` mode.** The request SHALL instead dispatch the Trigger.dev task `jobs-drain`,
  de-duplicated with a global idempotency key per job type and 10-second window, and SHALL NOT wait
  for the work.

In both modes, a failure of the work or of the dispatch SHALL NOT change the response of the request
that enqueued the job; it is logged and recovered later. The outbox SHALL remain the source of truth,
so a lost dispatch never loses work.

The `jobs-drain` task and the `jobs-sweep` scheduled task SHALL run on the `jobs` queue with a
concurrency limit of 1, a maximum duration of 300 seconds and at most 3 task attempts. Each drain
SHALL handle at most 10 worker steps and, when it handles a full batch of 10, SHALL dispatch a
continuation `jobs-drain` run. `jobs-sweep` SHALL run on the cron schedule `*/5 * * * *` and drain
like `jobs-drain`.

#### Scenario: Local inline run

- **WHEN** `MEDIA_WORKER_MODE` is `inline` and an update publish enqueues a cleanup job
- **THEN** the job has run by the time the publish response is returned

#### Scenario: Job failure does not fail the request

- **WHEN** the cleanup job run inline after a publish fails
- **THEN** the publish still answers `201`, and the job is `pending` for a retry

#### Scenario: Dispatch lost

- **WHEN** a job was enqueued in `trigger` mode but its `jobs-drain` dispatch failed
- **THEN** the next `jobs-sweep` run, at most five minutes later, runs the job

#### Scenario: Burst larger than one batch

- **WHEN** a drain handles 10 worker steps
- **THEN** it dispatches another `jobs-drain` run

### Requirement: Operator job commands

The system SHALL provide these commands. They read configuration like `db:migrate`, exit with a
non-zero status on failure, and always close the MongoDB client:

- `pnpm jobs:work` SHALL run generic worker steps until one reports `idle` or 100 steps have been
  handled, and print one JSON line per step with only the job id, type and outcome.
- `pnpm jobs:dead` SHALL list at most 100 `dead` generic jobs, newest first. Each line SHALL hold only
  the job id, type, attempts, `lastErrorCode` and `updatedAt`, never payload values.
- `pnpm jobs:retry <jobId>` SHALL move one `dead` generic job back to `pending`, with `attempts` `0`,
  `lastErrorCode` kept, and `availableAt` now. It SHALL fail with `Job is not dead: <jobId>` for a
  job in any other status, and with `Job not found: <jobId>` for an unknown id, changing nothing.

#### Scenario: Dead job retried

- **WHEN** an operator runs `pnpm jobs:retry` with the id of a `dead` cleanup job, and then
  `pnpm jobs:work`
- **THEN** the job is claimed again with a fresh budget of 5 attempts

#### Scenario: Retry of a live job refused

- **WHEN** an operator runs `pnpm jobs:retry` with the id of a `pending` job
- **THEN** the command fails with `Job is not dead: <jobId>`, and the job is unchanged

#### Scenario: Dead-letter listing without content

- **WHEN** an operator runs `pnpm jobs:dead`
- **THEN** each line shows the id, type, attempts, error code and time of a dead job, and no `giftId`
  or other payload value
