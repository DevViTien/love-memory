# Spec Delta

## MODIFIED Requirements

### Requirement: Draft DTO shape

Draft endpoints SHALL respond with the envelope `{ "data": { "gift": <draft DTO> } }`, where the DTO contains exactly these fields: `content` (the template field values), `createdAt` and `updatedAt` (ISO-8601 date-time strings), `ownerKind` (`anonymous` or `user`), `publicId`, `publication`, `revision`, `status` (`draft` or `published`), `templateId`, and `templateVersion`. `publication` SHALL be `null` for a draft. For a published gift it SHALL hold exactly `shareId`, `sharePath` (`/g/{shareId}`), `publishedAt` (ISO 8601) and `revision` of the gift's current publication, so the gift has unpublished changes exactly when the DTO's `revision` is greater than `publication.revision`. It SHALL also hold the gift's entitlement values that the Studio needs (`gift-plans`): `planId`, `maxPhotos` (an integer, or `null` when only the template limits apply), `watermark` (boolean) and `expiresAt` (ISO 8601). Responses MUST NOT expose raw database documents, internal gift IDs, owner or user IDs, anonymous draft IDs, claim tokens or their hashes, the access policy, the content of any publication, or the entitlement's grant source or price.

#### Scenario: Anonymous draft hides its credentials

- **WHEN** an anonymous creator creates a draft
- **THEN** `data.gift.ownerKind` is `anonymous`, `data.gift.publication` is `null`, and the DTO contains no `claimTokenHash`, anonymous draft ID, or internal `id`

#### Scenario: Published gift summary

- **WHEN** the owner reads a gift published at revision `7` whose working copy is at revision `9`
- **THEN** `data.gift.status` is `published`, `data.gift.revision` is `9`, and `data.gift.publication` holds the share id, `sharePath` `/g/{shareId}`, the publication time and `revision` `7`

#### Scenario: Entitlement in the summary

- **WHEN** the owner reads a gift first published on `free` at `2026-10-08T10:00:00Z`
- **THEN** `data.gift.publication` holds `planId` `free`, `maxPhotos` `3`, `watermark` `true` and `expiresAt` `2026-10-22T10:00:00.000Z`, and no `source`, `priceVnd` or `grantedAt`
