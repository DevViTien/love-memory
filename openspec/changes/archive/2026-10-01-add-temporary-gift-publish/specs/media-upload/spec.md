# Spec Delta

## MODIFIED Requirements

### Requirement: Gift-bound asset authorization

The system SHALL resolve the caller's accessors from the signed-in user session and the anonymous draft cookie, and SHALL authorize every media operation against the gift identified by `giftPublicId` using the gift draft access rules. Every media operation SHALL require the gift's status to be `draft`: upload initialization and completion, listing, reading, deletion and retry. An asset SHALL be visible to an operation only when the gift is accessible to the caller and is a `draft`, the asset belongs to that gift, and the asset's status is not `deleted`. An unauthorized gift, a gift that is not a `draft`, a missing asset, an asset of another gift, a `deleted` asset, or a malformed asset ID or `giftPublicId` on the single-asset routes SHALL all respond `404` with code `NOT_FOUND`, so the response does not reveal whether the asset exists. Signed download URLs of a published gift's assets SHALL be issued only as specified in `public-gift-viewer`. A new asset SHALL inherit the gift's owner: the user ID for a user-owned gift or the anonymous draft ID for an anonymous gift, never both.

#### Scenario: Asset of another gift

- **WHEN** a caller who can access gift A requests `GET /api/media/assets/{assetId}?giftPublicId=A` for an asset that belongs to gift B
- **THEN** the response is `404` with code `NOT_FOUND`

#### Scenario: Caller without access to the gift

- **WHEN** a caller with neither a matching session nor a matching anonymous draft cookie calls any media route for a gift
- **THEN** the response is `404` with code `NOT_FOUND`

#### Scenario: Anonymous draft upload

- **WHEN** a caller holding a valid anonymous draft cookie initializes an upload for their anonymous draft
- **THEN** the created asset is owned by that anonymous draft ID and has no user owner

#### Scenario: Assets of a published gift

- **WHEN** the owner of a published gift lists its assets, reads one, deletes one or retries one
- **THEN** each response is `404` with code `NOT_FOUND`, no download URL is signed, and every asset keeps its status

### Requirement: Asset deletion

The system SHALL delete an asset through `DELETE /api/media/assets/{assetId}` with a strict JSON body containing only `giftPublicId`. Deletion SHALL be allowed from any non-`deleted` status while the gift is a `draft`: the asset SHALL first move to `deleting`, then its source object and every derivative object SHALL be removed from storage, and only after all removals succeed SHALL the asset move to `deleted` and the response be `200` with `data` `{ assetId, deleted: true }`. The move to `deleting` SHALL be atomic with the gift still being a `draft`, so that it can never interleave with a publish of that gift: either the publish sees the asset leave `ready` and publishes nothing, or the deletion sees the gift published and responds `404` with code `NOT_FOUND` without changing the asset. A deletion refused because the gift is no longer a `draft` SHALL respond `404`, never `409`, whether the gift left `draft` before the request or during it. If any storage removal fails, the response SHALL be `500` with code `INTERNAL_ERROR` and the asset SHALL remain `deleting` so that the delete can be repeated or finished by background cleanup. If the final transition to `deleted` loses a race, the response SHALL be `409` with code `CONFLICT`.

#### Scenario: Delete a ready asset

- **WHEN** an authorized caller deletes a `ready` asset
- **THEN** the source and all derivative objects are removed and the asset becomes `deleted`
- **AND** the response is `200` with `deleted` `true`

#### Scenario: Storage cleanup fails

- **WHEN** removing one of the asset's objects fails
- **THEN** the response is `500` with code `INTERNAL_ERROR`
- **AND** the asset remains `deleting`

#### Scenario: Deletion races a publish

- **WHEN** the owner deletes a photo of a draft while a publish of that draft is committing
- **THEN** either the publish fails and the photo is deleted, or the publish succeeds and the deletion responds `404` with the photo still `ready`; never a published gift with a deleted photo

#### Scenario: Gift published before the delete reaches the asset

- **WHEN** the delete request passes authorization while the gift is a draft, and the gift is published before the asset moves to `deleting`
- **THEN** the response is `404` with code `NOT_FOUND`, not `409`, and the asset stays `ready`
