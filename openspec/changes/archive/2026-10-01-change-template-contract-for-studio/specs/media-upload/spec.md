# Spec Delta

## MODIFIED Requirements

### Requirement: Upload initialization

The system SHALL accept `POST /api/media/uploads/init` with a strict JSON body containing only `contentType`, `fieldId` (1 to 80 characters), `fileName` (1 to 180 characters), `giftPublicId` and `sizeBytes` (a positive integer no greater than 10485760 bytes). `contentType` MUST be one of `image/jpeg`, `image/png` or `image/webp`; any other value, including `image/svg+xml`, SHALL be rejected with `400` and code `VALIDATION_ERROR` before any asset or grant is created. Upload initialization SHALL only be allowed for a gift whose status is `draft`; otherwise the response SHALL be `404` with code `NOT_FOUND`. The `fieldId` MUST name a field of type `imageList` or `captionedImageList` in the gift's bound template version; otherwise the response SHALL be `422` with code `VALIDATION_ERROR`. Initialization requests SHALL be rate limited under the `media-upload` scope to 30 requests per 600-second window per subject (the signed-in user, else the anonymous draft, else the client IP), responding `429` with code `RATE_LIMITED` and a `Retry-After` header when exceeded.

#### Scenario: SVG upload rejected

- **WHEN** a caller initializes an upload with `contentType` `image/svg+xml`
- **THEN** the response is `400` with code `VALIDATION_ERROR`
- **AND** no asset is created

#### Scenario: Oversized declaration rejected

- **WHEN** a caller initializes an upload with `sizeBytes` 10485761
- **THEN** the response is `400` with code `VALIDATION_ERROR`

#### Scenario: Field that does not accept images

- **WHEN** a caller initializes an upload for a `fieldId` that is neither an `imageList` nor a `captionedImageList` field of the gift's template version
- **THEN** the response is `422` with code `VALIDATION_ERROR`

#### Scenario: Captioned image field accepts uploads

- **WHEN** an authorized caller initializes an `image/jpeg` upload for a `captionedImageList` field with free quota
- **THEN** the response is `201` and the new asset is bound to that field

#### Scenario: Gift that is not a draft

- **WHEN** a caller initializes an upload for an accessible gift whose status is not `draft`
- **THEN** the response is `404` with code `NOT_FOUND`

### Requirement: Atomic per-gift and per-field quotas

The system SHALL limit each gift to 30 active assets and each `imageList` or `captionedImageList` field to the field's `maxItems` active assets, where an active asset is any asset whose status is not `deleted` (including `failed` and `deleting` assets). Quota checks and slot reservation SHALL be atomic so that concurrent initialization requests cannot exceed either limit. A request that would exceed either limit SHALL respond `429` with code `RATE_LIMITED`. Deleting an asset SHALL free its slots once it reaches `deleted`.

#### Scenario: Field quota reached

- **WHEN** an `imageList` or `captionedImageList` field with `maxItems` 3 already has 3 non-deleted assets and the caller initializes another upload for it
- **THEN** the response is `429` with code `RATE_LIMITED`
- **AND** no asset is created

#### Scenario: Concurrent uploads at the limit

- **WHEN** two initialization requests for the same field race for its last free slot
- **THEN** at most one of them creates an asset and the other responds `429` with code `RATE_LIMITED`

### Requirement: Gift content references assets by ID only

Gift content SHALL reference uploaded images only by asset UUID, either as the items of `imageList` field values or as the `assetId` of `captionedImageList` items, and MUST NOT contain storage URLs, keys or image bytes. An asset SHALL be referenceable from a draft save only when it belongs to the same gift and the same field and its status is `initiated`, `uploaded`, `processing`, `ready` or `failed`; assets in `deleting` or `deleted` SHALL NOT be referenceable. The save-time validation, uniqueness and item-count rules are specified in `gift-drafts`.

#### Scenario: Deleted asset referenced

- **WHEN** a draft save references an asset of the same gift and field whose status is `deleted`
- **THEN** the save is rejected with `400` and code `VALIDATION_ERROR`

#### Scenario: Failed asset referenced

- **WHEN** a draft save references an asset of the same gift and field whose status is `failed`
- **THEN** the reference is accepted by media validation

#### Scenario: Captioned item with a storage URL

- **WHEN** a draft save sets a `captionedImageList` item to `{ "assetId": "<uuid>", "url": "https://store.example/photo.jpg" }`
- **THEN** the save is rejected with `400` and code `VALIDATION_ERROR`
