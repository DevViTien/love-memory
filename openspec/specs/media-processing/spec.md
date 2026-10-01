# Media Processing

## Purpose

Turns verified uploads into safe, private, responsive images in the background and keeps the media asset lifecycle consistent. It covers the asset state machine, the durable processing outbox with bounded retries and stale-lease recovery, the image processing outputs and failure codes, the cleanup of abandoned and deleted assets, and how the worker is run inline or on Trigger.dev. Upload requests, asset routes and DTOs are specified in `media-upload`; runtime readiness of the worker configuration is specified in `health-checks`.

## Requirements

### Requirement: Asset lifecycle states and transitions

Every media asset SHALL have exactly one status from `initiated`, `uploaded`, `processing`, `ready`, `failed`, `deleting` and `deleted`, and SHALL have exactly one owner (a user or an anonymous draft). The system SHALL only perform these transitions:

- `initiated` to `uploaded` (verified completion), to `failed` (completion found the object missing or mismatched), to `deleting` (user delete or expiry cleanup), or to `deleted` (upload grant could not be issued).
- `uploaded` to `processing` (worker claim) or to `deleting`.
- `processing` to `ready`, to `failed`, to `deleting`, or re-claimed as `processing` after a stale lease.
- `failed` to `processing` (automatic retry), to `uploaded` (manual retry) or to `deleting`.
- `ready` only to `deleting`.
- `deleting` to `deleted`, or staying `deleting` while cleanup is retried.

`deleted` SHALL be terminal and SHALL be excluded from every read, list and quota count. A `ready` asset MUST have at least one derivative.

#### Scenario: Ready asset cannot be reprocessed

- **WHEN** an asset is `ready`
- **THEN** its only possible next status is `deleting`

#### Scenario: Deleted is terminal

- **WHEN** an asset is `deleted`
- **THEN** no operation changes its status again and it is no longer returned by any media route

### Requirement: Durable transactional outbox

The system SHALL record processing work as outbox jobs of type `media.process.v1` whose payload contains only the asset ID, each with a unique deduplication key `media.process.v1:{assetId}:{attempt}`. The job for a completed upload SHALL be inserted in the same transaction that moves the asset from `initiated` to `uploaded`, and a manual retry SHALL, in one transaction, move the asset from `failed` to `uploaded` and either make its existing `pending` job available immediately or insert a new job. Background dispatch SHALL only wake the worker; the outbox SHALL remain the source of truth, so a lost or failed dispatch never loses work.

#### Scenario: Enqueue is atomic with completion

- **WHEN** an upload completion is accepted
- **THEN** the asset becomes `uploaded` and one `pending` `media.process.v1` job exists for it, or neither change is persisted

#### Scenario: Manual retry reuses a pending job

- **WHEN** a manual retry is accepted while the asset still has a `pending` job scheduled for a later time
- **THEN** that job becomes available immediately and no duplicate job is inserted

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

### Requirement: Processing outputs

For a claimed asset the worker SHALL read the private source object (reading at most 10485760 bytes), decode it, and produce three WebP derivatives bounded to 320, 768 and 1280 pixels on their longest side without enlarging smaller images, auto-oriented from EXIF and encoded at quality 82 with all source metadata (EXIF, orientation and similar) removed. It SHALL also produce a placeholder WebP at most 24 pixels on its longest side, returned as a `data:image/webp;base64,` URL; a placeholder whose data URL would exceed 2000 characters SHALL be omitted rather than stored. The worker SHALL record each derivative's width and height, and record the SHA-256 hex checksum of the original source bytes. The asset SHALL become `ready` with its derivatives, placeholder and checksum in the same transaction that marks its job `completed`. Only after that commit SHALL the source object be deleted; a failed source deletion SHALL be reported but SHALL NOT change the `ready` status. If the `ready` commit fails, any derivative objects already written SHALL be deleted.

#### Scenario: Successful processing

- **WHEN** a valid 4000x3000 JPEG that matches its declaration is processed
- **THEN** the asset becomes `ready` with derivatives of 320x240, 768x576 and 1280x960 WebP, a placeholder data URL and a 64-character hex checksum
- **AND** the derivatives carry no EXIF metadata and the source object is deleted

#### Scenario: Asset deleted during processing

- **WHEN** the asset leaves `processing` before the worker commits `ready`
- **THEN** the derivatives written for this attempt are deleted and the asset is not marked `ready`

#### Scenario: Extremely tall image

- **WHEN** a 1000x25000 image is processed
- **THEN** its placeholder is at most 24 pixels tall and the asset can still be listed, read and deleted

### Requirement: Decoded content verification and failure codes

The worker SHALL accept only images whose decoded format is JPEG, PNG or WebP and whose pixel count does not exceed 40000000, and SHALL require the decoded MIME type to equal the content type declared at upload. Failures SHALL be classified as:

- `OBJECT_MISSING`: the source object does not exist.
- `UPLOAD_INVALID`: the source exceeds the byte limit, or the decoded MIME type differs from the declared content type.
- `DECODE_FAILED`: the bytes are empty, cannot be decoded, exceed the pixel limit, or decode to an unsupported format such as SVG or GIF.
- `PROCESSING_FAILED`: any other error, treated as transient.

`OBJECT_MISSING`, `UPLOAD_INVALID` and `DECODE_FAILED` SHALL be terminal: the asset becomes `failed`, its job becomes `failed`, and the source object is deleted on a best-effort basis. For `PROCESSING_FAILED` the asset SHALL become `failed` and, while the asset has fewer than 3 attempts, its job SHALL return to `pending` with `availableAt` delayed by 2^attempts x 30 seconds (60 seconds after the first attempt, 120 seconds after the second); on the third attempt the job SHALL become `failed` and the source object SHALL be deleted on a best-effort basis, because no retry can use it any more.

#### Scenario: MIME spoofing detected

- **WHEN** an asset declared as `image/jpeg` decodes as PNG
- **THEN** the asset becomes `failed` with `failureCode` `UPLOAD_INVALID`, the job is not retried, and the source object is deleted

#### Scenario: Undecodable bytes

- **WHEN** the source bytes cannot be decoded as an image
- **THEN** the asset becomes `failed` with `failureCode` `DECODE_FAILED` and the job is not retried

#### Scenario: Transient failure is retried with backoff

- **WHEN** processing fails with an unclassified error on the asset's first attempt
- **THEN** the asset becomes `failed` with `failureCode` `PROCESSING_FAILED`
- **AND** its job becomes `pending` and available again 60 seconds later
- **AND** the source object is kept for the retry

#### Scenario: Last transient failure releases the source

- **WHEN** processing fails with an unclassified error on the asset's third attempt
- **THEN** the asset becomes `failed` with `failureCode` `PROCESSING_FAILED`, its job becomes `failed`, and the source object is deleted

### Requirement: Abandoned upload and interrupted delete cleanup

An `initiated` asset SHALL expire 10 minutes after its upload was initialized, and a user delete SHALL give its `deleting` asset a 60-second expiry. Whenever a worker step finds no claimable job, it SHALL claim the `initiated` or `deleting` asset with the oldest expiry that has passed, move it to `deleting` with a 10-minute lease, and delete its source and derivative objects without processing their bytes. When all deletions succeed the asset SHALL become `deleted`; otherwise it SHALL stay `deleting` with `failureCode` `PROCESSING_FAILED` and a new expiry 60 seconds later, so cleanup is retried.

#### Scenario: Abandoned direct upload

- **WHEN** an asset is still `initiated` more than 10 minutes after initialization and a worker step has no job to process
- **THEN** its source object is deleted and the asset becomes `deleted`

#### Scenario: Interrupted user delete is finished

- **WHEN** a user delete left an asset `deleting` because a storage removal failed, and 60 seconds have passed
- **THEN** a later worker step removes the remaining objects and the asset becomes `deleted`

### Requirement: Worker execution modes

The system SHALL choose the worker mode from `MEDIA_WORKER_MODE`, which MUST be `inline` or `trigger` when set; when unset, the mode SHALL be `trigger` if `NODE_ENV` is `production` and `inline` otherwise, and any other value SHALL be a configuration error. `trigger` mode SHALL require `TRIGGER_SECRET_KEY`. After an accepted upload completion or manual retry, `inline` mode SHALL run up to 10 worker steps before the request responds. `trigger` mode SHALL instead dispatch the `media-worker-drain` task with the payload `source` set to `upload-complete` or `retry`, de-duplicated with a global idempotency key per source, asset ID and 10-second window, so repeated requests for the same asset collapse while requests for different assets always dispatch, and the request never waits for image processing.

#### Scenario: Default production mode

- **WHEN** `MEDIA_WORKER_MODE` is unset and `NODE_ENV` is `production`
- **THEN** completions and retries dispatch `media-worker-drain` instead of processing inline

#### Scenario: Invalid mode

- **WHEN** `MEDIA_WORKER_MODE` is set to a value other than `inline` or `trigger`
- **THEN** the media runtime is treated as misconfigured

#### Scenario: Local inline processing

- **WHEN** `MEDIA_WORKER_MODE` is `inline` and an upload completion is accepted
- **THEN** the worker processes available jobs before the completion response is returned

#### Scenario: Uploads from different creators in the same window

- **WHEN** two different assets complete their uploads within the same 10-second window
- **THEN** each completion dispatches its own `media-worker-drain` run

### Requirement: Drain batching and scheduled sweep

The `media-worker-drain` task and the `media-worker-sweep` scheduled task SHALL run on the `media-worker` queue with a concurrency limit of 1, a maximum duration of 300 seconds and at most 3 task attempts. Each drain SHALL handle at most 10 worker steps and, when it handles a full batch of 10, SHALL dispatch a continuation `media-worker-drain` run with `source` `backlog` instead of waiting for the next sweep. The `media-worker-sweep` task SHALL run on the cron schedule `*/5 * * * *` and SHALL perform one expired-asset cleanup step before draining. The operator command `pnpm media:work` SHALL run worker steps until the outbox is idle or 100 steps have been handled.

#### Scenario: Burst larger than one batch

- **WHEN** a drain run handles 10 worker steps
- **THEN** it dispatches another `media-worker-drain` run with `source` `backlog`

#### Scenario: Dispatch was lost

- **WHEN** an upload was completed but its drain dispatch failed
- **THEN** the next `media-worker-sweep` run, at most five minutes later, processes the pending job
