## MODIFIED Requirements

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
