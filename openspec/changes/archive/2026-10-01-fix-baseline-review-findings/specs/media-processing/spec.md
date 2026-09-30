## MODIFIED Requirements

### Requirement: Job claiming, bounded attempts and stale-lease recovery

The worker SHALL claim the oldest available job (by `availableAt`, then creation time) that is either `pending` with `availableAt` in the past, or `processing` with no update for at least 10 minutes (a stale lease), and whose job attempts are below 3. Claiming SHALL atomically increment the job's and the asset's attempt counters and move the asset to `processing`, but only if the asset is `uploaded`, `failed` or `processing` and has fewer than 3 attempts. If the asset cannot be claimed, the job SHALL be marked `failed` and an asset still in `processing` SHALL become `failed` with `failureCode` `PROCESSING_FAILED`. A stale `processing` job that has already used 3 attempts SHALL be marked `failed` and its `processing` asset SHALL become `failed` with `failureCode` `PROCESSING_FAILED`. Whenever claiming turns an asset into a terminal `failed` this way, the worker SHALL delete that asset's source object on a best-effort basis. An asset SHALL never be processed more than 3 times in total, counting automatic and manual retries.

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
