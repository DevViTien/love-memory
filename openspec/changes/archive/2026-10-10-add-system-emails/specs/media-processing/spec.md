# Spec Delta

## MODIFIED Requirements

### Requirement: Decoded content verification and failure codes

The worker SHALL accept only images whose decoded format is JPEG, PNG or WebP and whose pixel count does not exceed 40000000, and SHALL require the decoded MIME type to equal the content type declared at upload. Failures SHALL be classified as:

- `OBJECT_MISSING`: the source object does not exist.
- `UPLOAD_INVALID`: the source exceeds the byte limit, or the decoded MIME type differs from the declared content type.
- `DECODE_FAILED`: the bytes are empty, cannot be decoded, exceed the pixel limit, or decode to an unsupported format such as SVG or GIF.
- `PROCESSING_FAILED`: any other error, treated as transient.

`OBJECT_MISSING`, `UPLOAD_INVALID` and `DECODE_FAILED` SHALL be terminal: the asset becomes `failed`, its job becomes `failed`, and the source object is deleted on a best-effort basis. For `PROCESSING_FAILED` the asset SHALL become `failed` and, while the asset has fewer than 3 attempts, its job SHALL return to `pending` with `availableAt` delayed by 2^attempts x 30 seconds (60 seconds after the first attempt, 120 seconds after the second); on the third attempt the job SHALL become `failed` and the source object SHALL be deleted on a best-effort basis, because no retry can use it any more. Whenever a processing failure leaves the job `failed` (a terminal code, or `PROCESSING_FAILED` on
the last attempt), the same transaction SHALL enqueue one `email.send.v1` job of kind
`photo_processing_failed` for the asset's gift (`system-emails`), with the deduplication key
`email.send.v1:photo_processing_failed:{giftId}:{assetId}`.

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

#### Scenario: Final failure notifies the owner

- **WHEN** a photo fails with `DECODE_FAILED`
- **THEN** the asset becomes `failed` and one `photo_processing_failed` email job is enqueued for its
  gift
