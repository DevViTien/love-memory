# Spec Delta

## MODIFIED Requirements

### Requirement: Pre-publish checks

After authorization, the system SHALL check the gift in this order and publish nothing when a
check fails:

1. The gift's status SHALL be `draft` or `published`. Otherwise the response SHALL be `409` with
   code `CONFLICT` and no `details`.
2. `expectedRevision` SHALL equal the gift's current revision. Otherwise the response SHALL be
   `409` with code `CONFLICT` and `details` holding `actualRevision` and `expectedRevision`.
3. For a `published` gift, `expectedRevision` SHALL be greater than the revision of the gift's
   current publication, so that each publish carries unpublished changes. Otherwise the response
   SHALL be `409` with code `CONFLICT` and `details.reason` `NO_UNPUBLISHED_CHANGES`, without
   `details.actualRevision`.
4. For a `published` gift, the server time SHALL be before the gift's `expiresAt` (`gift-plans`
   "Entitlement expiry"). Otherwise the response SHALL be `409` with code `CONFLICT` and
   `details.reason` `GIFT_EXPIRED`.
5. The plan. For a `draft`, `planId` SHALL be available to the owner (`gift-plans` "Plan
   availability"). Otherwise the response SHALL be `409` with code `CONFLICT` and `details.reason`
   `PLAN_NOT_AVAILABLE`. A plan available to the owner only through checkout SHALL answer `409` with
   code `CONFLICT` and `details.reason` `PAYMENT_REQUIRED`. For a `published` gift, `planId` SHALL equal the `planId` of the gift's
   entitlement. Otherwise the response SHALL be `409` with code `CONFLICT` and `details.reason`
   `PLAN_CHANGE_UNSUPPORTED`.
6. The gift's access policy SHALL be `unlisted`, the only policy this change can serve. Any other
   policy fails closed with `409`, code `CONFLICT` and `details.reason`
   `ACCESS_POLICY_UNSUPPORTED`.
7. The bound template version SHALL still be resolvable for editing, as for a draft save.
   Otherwise the response SHALL be `409` with code `CONFLICT` and `details.reason`
   `TEMPLATE_VERSION_NOT_EDITABLE`.
8. The bound template version SHALL have a registered template artifact. Otherwise, as for a draft
   bound to the retired `memory-box` `1.0.0`, the response SHALL be `409` with code `CONFLICT` and
   `details.reason` `TEMPLATE_VERSION_UNPUBLISHABLE`.
9. The stored content SHALL have no content issue as defined by `viewer-payload` "Content issues",
   computed from the stored content, the gift's asset records and the audio catalog. That means
   the full (non-draft) payload rules hold, every referenced asset is `ready`, belongs to this gift
   and field and is not detached from the working copy (`media-upload`), and the audio value, when
   present, is a selectable track. Otherwise the response SHALL be `400` with code
   `VALIDATION_ERROR` and one `fieldErrors` entry per issue: keyed by the field id, or by
   `{fieldId}.{itemIndex}` for an issue of one list item. The messages MUST NOT contain gift text.
10. The content's photo count (`gift-plans` "Plan catalog") SHALL NOT exceed the `maxPhotos` of
    the plan: the current version of `planId` for a `draft`, the gift's entitlement for a
    `published` gift. A `maxPhotos` of `null` never limits. Otherwise the response SHALL be `409`
    with code `CONFLICT`, `details.reason` `PLAN_PHOTO_LIMIT_EXCEEDED`, `details.maxPhotos` and
    `details.photoCount`.

The content checked SHALL be the stored content of the expected revision. The request body MUST NOT
carry content.

#### Scenario: Stale revision

- **WHEN** the owner publishes with `expectedRevision` `4` while the draft is at revision `5`
- **THEN** the response is `409` with code `CONFLICT`, `error.details.actualRevision` `5` and
  `error.details.expectedRevision` `4`, and the gift stays a `draft`

#### Scenario: Already published

- **WHEN** the owner sends a publish request with a new `Idempotency-Key` and `expectedRevision`
  `7` for a gift whose current publication has revision `7` and whose revision is `7`
- **THEN** the response is `409` with code `CONFLICT`, `error.details.reason`
  `NO_UNPUBLISHED_CHANGES` and no `error.details.actualRevision`, and the current publication is
  unchanged

#### Scenario: Status that cannot be published

- **WHEN** the owner sends a valid publish request for a gift whose status is neither `draft` nor
  `published`
- **THEN** the response is `409` with code `CONFLICT` without `details`, and nothing is written

#### Scenario: Invalid content

- **WHEN** the owner publishes a `memory-box` `1.1.0` draft whose content has no `receiver-name`
  and only 2 photos
- **THEN** the response is `400` with code `VALIDATION_ERROR`, and `error.fieldErrors` has entries
  for `receiver-name` and `memories`

#### Scenario: Invalid content in an update

- **WHEN** the owner of a published gift empties `receiver-name` in the working copy and publishes
  it
- **THEN** the response is `400` with code `VALIDATION_ERROR` and an `error.fieldErrors` entry for
  `receiver-name`, and recipients keep receiving the current publication

#### Scenario: Asset not ready

- **WHEN** the third photo of `memories` references an asset in status `processing`
- **THEN** the response is `400` with code `VALIDATION_ERROR` and an `error.fieldErrors` entry
  `memories.2`, and nothing is published

#### Scenario: Withdrawn audio track

- **WHEN** the stored `audio` value names a track that is now `withdrawn`
- **THEN** the response is `400` with code `VALIDATION_ERROR` and an `error.fieldErrors` entry for
  `audio`

#### Scenario: Artifact missing

- **WHEN** the owner publishes a complete draft bound to `memory-box` `1.0.0`, which has no
  registered artifact
- **THEN** the response is `409` with code `CONFLICT` and `error.details.reason`
  `TEMPLATE_VERSION_UNPUBLISHABLE`

#### Scenario: Preview and publish agree

- **WHEN** the preview of a draft or of a published gift's working copy lists no server issue
- **THEN** publishing the same revision passes check 9

#### Scenario: Unsupported access policy

- **WHEN** the owner publishes a complete draft whose access policy is `password`
- **THEN** the response is `409` with code `CONFLICT` and `error.details.reason`
  `ACCESS_POLICY_UNSUPPORTED`, and nothing is published

#### Scenario: Template version no longer editable

- **WHEN** the owner publishes a draft whose bound template version can no longer be resolved for
  editing
- **THEN** the response is `409` with code `CONFLICT` and `error.details.reason`
  `TEMPLATE_VERSION_NOT_EDITABLE`

#### Scenario: Paid plan not available

- **WHEN** the internal paid-plan grant is off and the owner publishes a complete draft with
  `planId` `standard`
- **THEN** the response is `409` with code `CONFLICT` and `error.details.reason`
  `PLAN_NOT_AVAILABLE`, and the gift stays a `draft`

#### Scenario: Too many photos for the Free plan

- **WHEN** the owner publishes a complete `memory-box` `1.1.0` draft with 5 ready photos on plan
  `free`
- **THEN** the response is `409` with code `CONFLICT`, `error.details.reason`
  `PLAN_PHOTO_LIMIT_EXCEEDED`, `error.details.maxPhotos` `3` and `error.details.photoCount` `5`,
  and the gift stays a `draft`

#### Scenario: Update over the entitlement's photo limit

- **WHEN** the owner of a gift published on `free` adds a fourth photo to the working copy and
  publishes it with `planId` `free`
- **THEN** the response is `409` with code `CONFLICT` and `error.details.reason`
  `PLAN_PHOTO_LIMIT_EXCEEDED`, and recipients keep receiving the current publication

#### Scenario: Plan change on update refused

- **WHEN** the owner of a gift published on `free` publishes an update with `planId` `standard`
- **THEN** the response is `409` with code `CONFLICT` and `error.details.reason`
  `PLAN_CHANGE_UNSUPPORTED`, and the entitlement is unchanged

#### Scenario: Update of an expired gift

- **WHEN** the owner of a gift whose `expiresAt` has passed saves the working copy and publishes it
- **THEN** the response is `409` with code `CONFLICT` and `error.details.reason` `GIFT_EXPIRED`,
  and nothing is written

#### Scenario: Paid plan needs a checkout

- **WHEN** a billing provider is configured and the owner publishes a complete draft on `standard`
- **THEN** the response is `409` with code `CONFLICT` and `details.reason` `PAYMENT_REQUIRED`, and
  the gift stays a `draft`
