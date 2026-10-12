## MODIFIED Requirements

### Requirement: Upload initialization

The system SHALL accept `POST /api/media/uploads/init` with a strict JSON body containing only `contentType`, `fieldId` (1 to 80 characters), `fileName` (1 to 180 characters), `giftPublicId` and `sizeBytes` (a positive integer no greater than 10485760 bytes). `contentType` MUST be one of `image/jpeg`, `image/png` or `image/webp`; any other value, including `image/svg+xml`, SHALL be rejected with `400` and code `VALIDATION_ERROR` before any asset or grant is created. Upload initialization SHALL only be allowed for a gift whose status is `draft` or `published`; otherwise the response SHALL be `404` with code `NOT_FOUND`. The `fieldId` MUST name a field of type `imageList`, `captionedImageList` or `image` in the gift's bound template version; otherwise the response SHALL be `422` with code `VALIDATION_ERROR`. Initialization requests SHALL be rate limited under the `media-upload` scope to 30 requests per 600-second window per subject (the signed-in user, else the anonymous draft, else the client IP), responding `429` with code `RATE_LIMITED` and a `Retry-After` header when exceeded.

#### Scenario: SVG upload rejected

- **WHEN** a caller initializes an upload with `contentType` `image/svg+xml`
- **THEN** the response is `400` with code `VALIDATION_ERROR`
- **AND** no asset is created

#### Scenario: Oversized declaration rejected

- **WHEN** a caller initializes an upload with `sizeBytes` 10485761
- **THEN** the response is `400` with code `VALIDATION_ERROR`

#### Scenario: Field that does not accept images

- **WHEN** a caller initializes an upload for a `fieldId` that is neither an `imageList`, a `captionedImageList` nor an `image` field of the gift's template version
- **THEN** the response is `422` with code `VALIDATION_ERROR`

#### Scenario: Captioned image field accepts uploads

- **WHEN** an authorized caller initializes an `image/jpeg` upload for a `captionedImageList` field with free quota
- **THEN** the response is `201` and the new asset is bound to that field

#### Scenario: Gift that is not a draft

- **WHEN** a caller initializes an `image/jpeg` upload, for a field with free quota, of an accessible published gift, and of an accessible gift whose status is neither `draft` nor `published`
- **THEN** the published gift's request is answered `201`, and the other is answered `404` with code `NOT_FOUND`

#### Scenario: Single photo field accepts uploads

- **WHEN** an authorized caller initializes an `image/jpeg` upload for an empty `image` field
- **THEN** the response is `201` and the new asset is bound to that field

### Requirement: Atomic per-gift and per-field quotas

The system SHALL limit each gift to 30 active assets and each `imageList` or `captionedImageList` field to the field's `maxItems` active assets, each `image` field to 1 active asset, where an active asset is any asset whose status is not `deleted` (including `failed` and `deleting` assets) and that is not detached from the working copy. Quota checks and slot reservation SHALL be atomic so that concurrent initialization requests cannot exceed either limit. A request that would exceed either limit SHALL respond `429` with code `RATE_LIMITED`. Deleting an asset SHALL free its slots once it reaches `deleted`, and detaching it SHALL free its slots at once.

#### Scenario: Field quota reached

- **WHEN** an `imageList` or `captionedImageList` field with `maxItems` 3 already has 3 non-deleted assets and the caller initializes another upload for it
- **THEN** the response is `429` with code `RATE_LIMITED`
- **AND** no asset is created

#### Scenario: Concurrent uploads at the limit

- **WHEN** two initialization requests for the same field race for its last free slot
- **THEN** at most one of them creates an asset and the other responds `429` with code `RATE_LIMITED`

#### Scenario: Replacing a published photo in a full field

- **WHEN** a published gift's `memories` field holds 8 photos with `maxItems` 8, the owner deletes one that the current publication references, and initializes a new upload for `memories`
- **THEN** the deletion detaches the photo and the upload answers `201`

#### Scenario: Single photo field quota

- **WHEN** an `image` field already has one non-deleted asset and the caller initializes another
  upload for it
- **THEN** the response is `429` with code `RATE_LIMITED`, and after the photo is deleted a new
  upload answers `201`
