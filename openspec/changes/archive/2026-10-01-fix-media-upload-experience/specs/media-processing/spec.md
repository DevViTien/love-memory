## MODIFIED Requirements

### Requirement: Job claiming, bounded attempts and stale-lease recovery

The worker SHALL claim the oldest available job (by `availableAt`, then creation time) that is either `pending` with `availableAt` in the past, or `processing` with no update for at least 10 minutes (a stale lease), and whose job attempts are below 3. Claiming SHALL atomically increment the job's and the asset's attempt counters and move the asset to `processing`, but only if the asset is `uploaded`, `failed` or `processing` and has fewer than 3 attempts. If the asset cannot be claimed, the job SHALL be marked `failed` and an asset still in `processing` SHALL become `failed` with `failureCode` `PROCESSING_FAILED`. A stale `processing` job that has already used 3 attempts SHALL be marked `failed` and its `processing` asset SHALL become `failed` with `failureCode` `PROCESSING_FAILED`. Whenever claiming turns an asset into a terminal `failed` this way, the worker SHALL delete that asset's source object on a best-effort basis. A job marked `failed` by claiming without processing its asset (for example because the asset was deleted after the job was enqueued) SHALL count as a handled worker step with the outcome `discarded`, never as an idle outbox, so a drain (inline, `media-worker-drain`, `media-worker-sweep` or `pnpm media:work`) continues with the next available job in the same run. An asset SHALL never be processed more than 3 times in total, counting automatic and manual retries.

#### Scenario: Crashed worker lease is recovered

- **WHEN** a job has been `processing` without update for 10 minutes and has fewer than 3 attempts
- **THEN** the next worker step re-claims it and processes the asset again

#### Scenario: Stale lease with exhausted budget

- **WHEN** a job has been `processing` without update for 10 minutes and already has 3 attempts
- **THEN** the job becomes `failed` and its asset becomes `failed` with `failureCode` `PROCESSING_FAILED`
- **AND** the asset's source object is deleted

#### Scenario: Deleted asset job

- **WHEN** a claimed job refers to an asset that is `deleting` or `deleted`
- **THEN** the job becomes `failed` and the asset is not processed
- **AND** the worker step reports `discarded` instead of `idle`

#### Scenario: Stale job ahead of a new upload

- **WHEN** the oldest available job refers to a `deleted` asset and a newer available job refers to an `uploaded` asset
- **THEN** one drain marks the first job `failed` and, in the same run, processes the second asset to `ready`
