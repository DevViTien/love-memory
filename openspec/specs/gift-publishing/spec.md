# gift-publishing Specification

## Purpose

Lets the signed-in owner of a gift draft publish it once, under an internal free entitlement,
into an immutable snapshot that pins the exact template version and artifact, and gives it a
share link. It covers the publish endpoint, its checks and idempotency, the gift state transition,
what publishing ends, and the owner's view of a published gift in the Studio.

## Requirements

### Requirement: Publish endpoint and authorization

The system SHALL publish a draft through `POST /api/gifts/{publicId}/publish`. The request SHALL
carry an `Idempotency-Key` header with a UUID and a strict JSON body that holds only
`expectedRevision`, a non-negative integer. The checks run in this order:

1. the media type and origin guards of `mutation-request-guards`;
2. the `publicId` format. A malformed id SHALL respond `404` with code `NOT_FOUND`;
3. the `Idempotency-Key` header. A missing or malformed key SHALL respond `400` with code
   `VALIDATION_ERROR` and `fieldErrors.idempotencyKey`;
4. the `gift-publish` rate limit;
5. the body. An invalid body SHALL respond `400` with code `VALIDATION_ERROR`;
6. the session. A request without a signed-in user SHALL respond `401` with code `UNAUTHORIZED`;
7. ownership. The gift SHALL be found only when its owner is the signed-in user. The anonymous
   draft cookie MUST NOT authorize publishing, and the user's role, including `admin`, grants
   nothing. A gift that does not exist, or that the user does not own, including an unclaimed
   anonymous draft whose cookie the user holds, SHALL respond `404` with code `NOT_FOUND` and the
   message `Gift draft was not found.`;
8. the internal publish entitlement (see "Internal publish entitlement").

Only after these checks SHALL the idempotency replay and the pre-publish checks run.

#### Scenario: Not signed in

- **WHEN** a request without a session sends `POST /api/gifts/{publicId}/publish` with a valid key
  and body
- **THEN** the response is `401` with code `UNAUTHORIZED`, and nothing is published

#### Scenario: Not the owner

- **WHEN** a signed-in user who does not own the gift sends a valid publish request
- **THEN** the response is `404` with code `NOT_FOUND`, identical to the response for a
  nonexistent `publicId`

#### Scenario: Unclaimed anonymous draft

- **WHEN** a signed-in user who holds the anonymous cookie of an unclaimed draft sends a valid
  publish request for it
- **THEN** the response is `404` with code `NOT_FOUND`, and the draft stays a `draft`

#### Scenario: Missing idempotency key

- **WHEN** the owner sends the request without an `Idempotency-Key` header
- **THEN** the response is `400` with code `VALIDATION_ERROR` and `error.fieldErrors.idempotencyKey`

#### Scenario: Unexpected body

- **WHEN** the owner sends the body `{ "expectedRevision": 3, "shareId": "abc" }`
- **THEN** the response is `400` with code `VALIDATION_ERROR`, and nothing is published

### Requirement: Internal publish entitlement

Publishing SHALL require the internal free entitlement. The entitlement is granted to every owner
when the server environment variable `INTERNAL_PUBLISH_ENABLED` is exactly `true`, and to nobody
otherwise. It SHALL be off when the variable is absent, and it MUST be off whenever `VERCEL_ENV` is
`production`, whatever the variable says. Any value other than `true` or `false` SHALL be treated
as `false` and MUST NOT stop the application. When the entitlement is off, an authorized owner
SHALL receive `403` with code `FORBIDDEN`, and nothing SHALL be published. A requester who is not
the owner SHALL receive the `404` of "Publish endpoint and authorization" first, so the flag never
reveals that a gift exists.

#### Scenario: Flag off for the owner

- **WHEN** `INTERNAL_PUBLISH_ENABLED` is absent and the owner sends a valid publish request
- **THEN** the response is `403` with code `FORBIDDEN`, and the gift stays a `draft`

#### Scenario: Flag off for a non-owner

- **WHEN** `INTERNAL_PUBLISH_ENABLED` is absent and a signed-in non-owner sends a valid publish
  request
- **THEN** the response is `404` with code `NOT_FOUND`

#### Scenario: Production never grants it

- **WHEN** `INTERNAL_PUBLISH_ENABLED` is `true` and `VERCEL_ENV` is `production`
- **THEN** an owner's publish request is answered `403` with code `FORBIDDEN`

### Requirement: Pre-publish checks

After authorization, the system SHALL check the gift in this order and publish nothing when a
check fails:

1. The gift's status SHALL be `draft`. Otherwise the response SHALL be `409` with code `CONFLICT`
   and no `details`.
2. `expectedRevision` SHALL equal the gift's current revision. Otherwise the response SHALL be
   `409` with code `CONFLICT` and `details` holding `actualRevision` and `expectedRevision`.
3. The gift's access policy SHALL be `unlisted`, the only policy this change can serve. Any other
   policy fails closed with `409`, code `CONFLICT` and `details.reason`
   `ACCESS_POLICY_UNSUPPORTED`.
4. The bound template version SHALL still be resolvable for editing, as for a draft save.
   Otherwise the response SHALL be `409` with code `CONFLICT` and `details.reason`
   `TEMPLATE_VERSION_NOT_EDITABLE`.
5. The bound template version SHALL have a registered template artifact. Otherwise, as for a draft
   bound to the retired `memory-box` `1.0.0`, the response SHALL be `409` with code `CONFLICT` and
   `details.reason` `TEMPLATE_VERSION_UNPUBLISHABLE`.
6. The stored content SHALL have no content issue as defined by `viewer-payload` "Content issues",
   computed from the stored content, the gift's asset records and the audio catalog. That means
   the full (non-draft) payload rules hold, every referenced asset is `ready` and belongs to this
   gift and field, and the audio value, when present, is a selectable track. Otherwise the response
   SHALL be `400` with code `VALIDATION_ERROR` and one `fieldErrors` entry per issue: keyed by the
   field id, or by `{fieldId}.{itemIndex}` for an issue of one list item. The messages MUST NOT
   contain gift text.

The content checked SHALL be the stored content of the expected revision. The request body MUST NOT
carry content.

#### Scenario: Stale revision

- **WHEN** the owner publishes with `expectedRevision` `4` while the draft is at revision `5`
- **THEN** the response is `409` with code `CONFLICT`, `error.details.actualRevision` `5` and
  `error.details.expectedRevision` `4`, and the gift stays a `draft`

#### Scenario: Already published

- **WHEN** the owner sends a publish request with a new `Idempotency-Key` for a gift that is
  already `published`
- **THEN** the response is `409` with code `CONFLICT` without `details`, and the existing
  publication is unchanged

#### Scenario: Invalid content

- **WHEN** the owner publishes a `memory-box` `1.1.0` draft whose content has no `receiver-name`
  and only 2 photos
- **THEN** the response is `400` with code `VALIDATION_ERROR`, and `error.fieldErrors` has entries
  for `receiver-name` and `memories`

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

- **WHEN** the preview of a draft lists no server issue
- **THEN** publishing the same revision passes check 6

#### Scenario: Unsupported access policy

- **WHEN** the owner publishes a complete draft whose access policy is `password`
- **THEN** the response is `409` with code `CONFLICT` and `error.details.reason`
  `ACCESS_POLICY_UNSUPPORTED`, and nothing is published

#### Scenario: Template version no longer editable

- **WHEN** the owner publishes a draft whose bound template version can no longer be resolved for
  editing
- **THEN** the response is `409` with code `CONFLICT` and `error.details.reason`
  `TEMPLATE_VERSION_NOT_EDITABLE`

### Requirement: Immutable publication snapshot

A successful publish SHALL, in one database transaction, do all of the following, or none of them:

- move the gift from `draft` through `publishing` to `published`, following the gift state
  transitions, set its `shareId` and `publishedAt`, set `updatedAt`, and keep its `revision`
  unchanged. The write SHALL be conditional on the owner, status `draft`, access mode `unlisted`
  and the expected revision at the moment of writing;
- confirm that every referenced asset is still `ready`, of this gift and of its field, with a
  write to each of those asset records, so that a concurrent asset deletion conflicts with the
  publish instead of interleaving with it;
- insert one publication record holding `giftId`, `shareId`, `revision`, `templateId`,
  `templateVersion`, the registered artifact `contentHash` (`artifactContentHash`), the stored
  content, the referenced asset ids in content order (`assetIds`), the audio track id or `null`
  (`audioTrackId`) and `publishedAt`;
- record the idempotency key (see "Idempotent publish").

When a condition fails inside the transaction, nothing SHALL be written, and the response SHALL be
the one the matching check of "Pre-publish checks" or "Publish endpoint and authorization" gives.
No API SHALL modify or delete a publication record. The `publishing` status is never observable
outside the transaction. On success the response SHALL be `201` with `data.publication` holding
exactly `publicId`, `status` (`published`), `shareId`, `sharePath` (`/g/{shareId}`),
`publishedAt` (ISO 8601) and `revision`.

#### Scenario: Owner publishes a complete gift

- **WHEN** the entitled owner publishes a complete `memory-box` `1.1.0` draft at revision `7` with
  `expectedRevision` `7`
- **THEN** the response is `201` with `data.publication.status` `published`, a 22-character
  `shareId`, `sharePath` `/g/{shareId}` and `revision` `7`
- **AND** the stored publication holds `templateVersion` `1.1.0`, the artifact's 64-character
  `contentHash` and the content of revision `7`

#### Scenario: Concurrent save loses

- **WHEN** a draft save to revision `8` commits between the publish checks and the publish write
- **THEN** the publish writes nothing and responds `409` with code `CONFLICT` and
  `error.details.actualRevision` `8`

#### Scenario: Asset deleted during publish

- **WHEN** a referenced asset leaves `ready` before the publish transaction commits
- **THEN** no publication is stored, the gift stays a `draft`, and the response is `400` with code
  `VALIDATION_ERROR`

#### Scenario: Invalid transition refused

- **WHEN** the domain is asked to publish a gift whose status is `published`, or to move a gift
  from `draft` to `published` without passing through `publishing`
- **THEN** it refuses with an invalid-transition error, and nothing is written

### Requirement: Share id

Each publication SHALL get a new share id: 16 bytes from a cryptographically secure random source,
encoded as unpadded base64url (22 characters). Share ids SHALL be unique across gifts and across
publication records, enforced by unique database indexes. The recipient URL SHALL be
`/g/{shareId}`. A share id MUST NOT be derived from the gift's internal id, its `publicId`, the
owner or the content.

#### Scenario: Share id format

- **WHEN** a gift is published
- **THEN** its `shareId` matches `^[A-Za-z0-9_-]{22}$` and differs from its `publicId`

#### Scenario: Duplicate share id rejected by the database

- **WHEN** a second gift or publication record is written with an existing `shareId`
- **THEN** MongoDB rejects the write with a duplicate-key error

### Requirement: Idempotent publish

Each `Idempotency-Key` SHALL be unique within the `gift-publish` scope and SHALL be kept for 24
hours after a successful publish. The key is recorded only by a successful publish, so a request
that failed MAY be retried with the same key and a different `expectedRevision`. A repeated request
with the key of a successful publish SHALL return `201` with the same publication only when it
comes from the same signed-in user, for the same `publicId`, with the same `expectedRevision`. In
every other case it SHALL respond `409` with code `CONFLICT` and publish nothing. Concurrent
requests with the same key SHALL produce at most one publication.

#### Scenario: Lost response replayed

- **WHEN** the owner repeats a successful publish request with the same key and body within 24
  hours
- **THEN** the response is `201` with the same `shareId`, `publishedAt` and `revision`, and no
  second publication exists

#### Scenario: Replay with a different body

- **WHEN** the owner reuses the key of a successful publish with another `expectedRevision`, or for
  another gift
- **THEN** the response is `409` with code `CONFLICT`

#### Scenario: Retry after a validation failure

- **WHEN** a publish fails with `400`, the owner fixes the content, and publishes again with the
  same key and the new revision
- **THEN** the publish is accepted

#### Scenario: Double click

- **WHEN** two publish requests with the same key and body arrive at the same time
- **THEN** both responses are `201` with the same `shareId`, and exactly one publication exists

### Requirement: Publishing ends draft access

Once a gift is `published`, its draft access SHALL end:

- `GET` and `PATCH /api/gifts/{publicId}`, the claim endpoint and preview link issuance SHALL
  respond `404` with code `NOT_FOUND`, as for any non-draft;
- preview links issued before publishing SHALL render the not-found page;
- every media route SHALL respond `404` with code `NOT_FOUND` for the gift's assets (see
  `media-upload`), so its assets can no longer be deleted or re-processed, and signed URLs of its
  assets SHALL be issued only through `public-gift-viewer`.

The gift's content, revision history and assets SHALL be kept unchanged.

#### Scenario: Preview link after publish

- **WHEN** the owner opens a preview link, issued before publishing, after the gift was published
- **THEN** the not-found page is rendered

#### Scenario: Photo deletion refused

- **WHEN** the owner sends `DELETE /api/media/assets/{assetId}` for a photo of a published gift
- **THEN** the response is `404` with code `NOT_FOUND`, and the asset stays `ready`

#### Scenario: Save after publish

- **WHEN** another Studio tab sends `PATCH /api/gifts/{publicId}` after the gift was published
- **THEN** the response is `404` with code `NOT_FOUND`, and the content is unchanged

### Requirement: Published gift in the Studio

`/studio/{publicId}` SHALL show a published panel instead of the editor when the gift is
`published` and the request is authorized for it under the draft access rules of
`gift-draft-ownership`. The panel SHALL show:

- the heading `Đã xuất bản`;
- the absolute share URL (the application origin followed by `/g/{shareId}`) in a read-only field
  labelled `Đường dẫn món quà`;
- a `Sao chép liên kết` button. It copies the URL and then reads `Đã sao chép`. When copying fails,
  the panel shows `Không sao chép được — hãy chọn đường dẫn và sao chép thủ công.`;
- a link `Mở món quà` to `/g/{shareId}`;
- the notes `Ai có đường dẫn này đều mở được món quà. Chỉ chia sẻ với người nhận.` and
  `Món quà đã xuất bản không thể chỉnh sửa.`

The page MUST NOT send autosave or draft requests for a published gift. For a gift in any other
non-draft status, or for an unauthorized request, the page SHALL render the not-found page.

#### Scenario: Owner reopens a published gift

- **WHEN** the owner opens `/studio/{publicId}` of a published gift
- **THEN** the page shows `Đã xuất bản` and the share URL ending in `/g/{shareId}`, and no editor

#### Scenario: Someone else opens the Studio URL

- **WHEN** a browser without the owner's session opens `/studio/{publicId}` of a published gift
- **THEN** the not-found page is rendered

#### Scenario: Copy the link

- **WHEN** the owner chooses `Sao chép liên kết` and the clipboard accepts the text
- **THEN** the clipboard holds the absolute share URL and the button reads `Đã sao chép`
