# Spec Delta

## MODIFIED Requirements

### Requirement: Immutable publication snapshot

A successful publish SHALL, in one database transaction, do all of the following, or none of them:

- move the gift through `publishing` to `published`, following the gift state transitions: from
  `draft` for a first publish, from `published` for an update. It SHALL set `publishedRevision` to
  the published revision and `publishedAt` to the time of this publication, set `updatedAt`, and
  keep its `revision` unchanged. A first publish SHALL also set the gift's `shareId`, and grant the
  gift's entitlement and `expiresAt` from the current version of `planId` (`gift-plans` "Gift
  entitlement snapshot"); an update SHALL keep the `shareId`, the entitlement and `expiresAt`. The
  write SHALL be conditional, at the moment of writing, on the owner, access mode `unlisted`, the
  expected revision, and the state the checks saw: status `draft` for a first publish, or status
  `published` with the same `publishedRevision` and an `expiresAt` later than the time of writing
  for an update;
- confirm that every referenced asset is still `ready`, of this gift and of its field, and not
  detached, with a write to each of those asset records, so that a concurrent asset deletion or
  detach conflicts with the publish instead of interleaving with it;
- insert one publication record holding `giftId`, `shareId`, `revision`, `templateId`,
  `templateVersion`, the registered artifact `contentHash` (`artifactContentHash`), the stored
  content, the referenced asset ids in content order (`assetIds`), the audio track id or `null`
  (`audioTrackId`) and `publishedAt`;
- record the idempotency key (see "Idempotent publish");
- for an update, enqueue one `gift.assets.cleanup.v1` job for the gift (`media-upload` "Cleanup of
  detached assets"), with the deduplication key `gift.assets.cleanup.v1:{giftId}:{revision}` of the
  published revision. A first publish enqueues no cleanup job.

The new publication becomes the gift's current publication when the transaction commits. Earlier
publication records of the gift SHALL be kept unchanged and SHALL NOT be served to recipients. When
a condition fails inside the transaction, nothing SHALL be written, and the response SHALL be the
one the matching check of "Pre-publish checks" or "Publish endpoint and authorization" gives. No
API SHALL modify or delete a publication record. The `publishing` status is never observable
outside the transaction. On success the response SHALL be `201` with `data.publication` holding
exactly `publicId`, `status` (`published`), `shareId`, `sharePath` (`/g/{shareId}`),
`publishedAt` (ISO 8601), `revision`, `planId` (the entitlement's) and `expiresAt` (ISO 8601).

#### Scenario: Owner publishes a complete gift

- **WHEN** the entitled owner publishes a complete `memory-box` `1.1.0` draft at revision `7` with
  `expectedRevision` `7` and `planId` `free`
- **THEN** the response is `201` with `data.publication.status` `published`, a 22-character
  `shareId`, `sharePath` `/g/{shareId}`, `revision` `7`, `planId` `free` and an `expiresAt` 14 days
  after `publishedAt`
- **AND** the stored publication holds `templateVersion` `1.1.0`, the artifact's 64-character
  `contentHash` and the content of revision `7`, and the gift's `publishedRevision` is `7`

#### Scenario: Owner updates a published gift

- **WHEN** the owner of a gift published at revision `7` saves the working copy to revision `9` and
  publishes with `expectedRevision` `9`
- **THEN** the response is `201` with the same `shareId`, `revision` `9` and a `publishedAt` later
  than that of revision `7`, with the same `planId` and `expiresAt` as the first publish
- **AND** a new publication for revision `9` is stored, the publication for revision `7` is
  unchanged, and the gift's `publishedRevision` is `9`

#### Scenario: Concurrent save loses

- **WHEN** a draft save to revision `8` commits between the publish checks and the publish write
- **THEN** the publish writes nothing and responds `409` with code `CONFLICT` and
  `error.details.actualRevision` `8`

#### Scenario: Concurrent updates of one revision

- **WHEN** two update requests with different `Idempotency-Key` values and the same
  `expectedRevision` `9` reach a published gift at the same time
- **THEN** exactly one publication for revision `9` exists, one response is `201`, and the other is
  `409` with code `CONFLICT` and `error.details.reason` `NO_UNPUBLISHED_CHANGES`

#### Scenario: Asset deleted during publish

- **WHEN** a referenced asset leaves `ready` before the publish transaction commits
- **THEN** no publication is stored, the gift keeps its status and current publication, and the
  response is `400` with code `VALIDATION_ERROR`

#### Scenario: Invalid transition refused

- **WHEN** the domain is asked to move a gift from `draft` or `published` to `published` without
  passing through `publishing`, or to update a gift whose status is not `published`
- **THEN** it refuses with an invalid-transition error, and nothing is written

#### Scenario: Expiry reached during an update

- **WHEN** a gift's `expiresAt` passes between the update's checks and its write
- **THEN** nothing is written and the response is `409` with code `CONFLICT` and
  `error.details.reason` `GIFT_EXPIRED`

#### Scenario: Update enqueues the cleanup of detached photos

- **WHEN** the owner publishes revision `9` of a published gift
- **THEN** exactly one `gift.assets.cleanup.v1` job with the deduplication key
  `gift.assets.cleanup.v1:{giftId}:9` is committed with the new publication
- **AND** a first publish of a draft commits no such job
