# Spec Delta

## ADDED Requirements

### Requirement: Cleanup of detached assets

The system SHALL delete the assets that no served publication needs, through the generic job
`gift.assets.cleanup.v1` (`background-jobs`), whose payload is `{ giftId }` and whose deduplication
key is `gift.assets.cleanup.v1:{giftId}:{revision}`.

**Which assets.** For its gift the job SHALL select every asset that meets all of these:

- it belongs to the gift;
- it is detached from the working copy (`detachedAt` set);
- it is `ready`;
- its id is not in the `assetIds` of the gift's current publication (the one whose revision equals
  the gift's `publishedRevision`).

**Deleting each one.** For each selected asset the job SHALL do what "Asset deletion" does for a
deletable asset:

1. move it to `deleting`, conditionally on it still being detached and `ready`;
2. remove its source object and every derivative object from storage;
3. only after all removals succeed, mark it `deleted`.

An asset that is not detached, or that the current publication references, MUST NOT be changed.

**Failures and no-ops.**

- If a storage removal fails, the job SHALL still handle the other selected assets, and then fail
  with the retryable code `STORAGE_DELETE_FAILED`. The failed asset stays `deleting` with an expiry
  60 seconds later, so the media expired-asset cleanup (`media-processing`) finishes it.
- A gift that no longer exists, or whose status is not `published`, SHALL complete the job without
  changing anything.
- A published gift whose current publication cannot be read SHALL fail the job with the retryable
  code `PUBLICATION_UNREADABLE` and change nothing, because then nothing proves a photo unused.
- Running the job again SHALL find nothing left to do.

Because a detached asset can never again be referenced by a save of the working copy, no later
publication can need an asset this job deletes.

#### Scenario: Replaced photo deleted after the update

- **WHEN** the owner of a published gift deletes a photo of its current publication (it is
  detached), adds another, and publishes the update
- **THEN** the cleanup job for that revision deletes the detached photo's objects, and the photo
  becomes `deleted`
- **AND** recipients receive the new publication, which does not reference it

#### Scenario: Photo still in the current publication

- **WHEN** a cleanup job runs for a gift whose detached photo is still referenced by the current
  publication, because no update has been published yet
- **THEN** the photo stays `ready` with all its objects

#### Scenario: Storage removal fails

- **WHEN** removing one object of a selected photo fails
- **THEN** the job's other photos are still deleted, the job fails with `STORAGE_DELETE_FAILED` and
  is retried, and the photo is `deleting` until the expired-asset cleanup removes the rest

#### Scenario: Gift gone

- **WHEN** a cleanup job runs for a gift that no longer exists
- **THEN** the job completes and changes nothing
