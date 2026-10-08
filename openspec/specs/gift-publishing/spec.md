# gift-publishing Specification

## Purpose

Lets the signed-in owner of a gift publish it on a plan of `gift-plans`, and publish newer
revisions later, into immutable snapshots that pin the exact template version and artifact behind
one stable share link. It covers the publish endpoint, its checks and idempotency, the entitlement
granted at the first publish, the gift state transition, and the owner's view of a published gift
in the Studio.

## Requirements

### Requirement: Publish endpoint and authorization

The system SHALL publish a draft through `POST /api/gifts/{publicId}/publish`. The request SHALL
carry an `Idempotency-Key` header with a UUID and a strict JSON body that holds only
`expectedRevision`, a non-negative integer, and `planId`, one of the plan ids of `gift-plans`
(`free` or `standard`). The checks run in this order:

1. the media type and origin guards of `mutation-request-guards`;
2. the `publicId` format. A malformed id SHALL respond `404` with code `NOT_FOUND`;
3. the `Idempotency-Key` header. A missing or malformed key SHALL respond `400` with code
   `VALIDATION_ERROR` and `fieldErrors.idempotencyKey`;
4. the `gift-publish` rate limit;
5. the body. An invalid body, including a missing or unknown `planId`, SHALL respond `400` with
   code `VALIDATION_ERROR`;
6. the session. A request without a signed-in user SHALL respond `401` with code `UNAUTHORIZED`;
7. ownership. The gift SHALL be found only when its owner is the signed-in user. The anonymous
   draft cookie MUST NOT authorize publishing, and the user's role, including `admin`, grants
   nothing. A gift that does not exist, or that the user does not own, including an unclaimed
   anonymous draft whose cookie the user holds, SHALL respond `404` with code `NOT_FOUND` and the
   message `Gift draft was not found.`

Only after these checks SHALL the idempotency replay and the pre-publish checks run, so no plan,
expiry or entitlement answer ever reveals that a gift exists to someone who does not own it.

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

- **WHEN** the owner sends the body `{ "expectedRevision": 3, "planId": "free", "shareId": "abc" }`,
  or the body `{ "expectedRevision": 3, "shareId": "abc" }`
- **THEN** the response is `400` with code `VALIDATION_ERROR`, and nothing is published

#### Scenario: Missing or unknown plan

- **WHEN** the owner sends the body `{ "expectedRevision": 3 }` or
  `{ "expectedRevision": 3, "planId": "premium" }`
- **THEN** the response is `400` with code `VALIDATION_ERROR`, and nothing is published

#### Scenario: Plan refusal hidden from non-owners

- **WHEN** a signed-in user who does not own the gift sends a valid publish request on plan
  `standard` while the internal paid-plan grant is off
- **THEN** the response is `404` with code `NOT_FOUND`, not a plan refusal

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
   `PLAN_NOT_AVAILABLE`. For a `published` gift, `planId` SHALL equal the `planId` of the gift's
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
- record the idempotency key (see "Idempotent publish").

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

### Requirement: Share id

A gift SHALL get its share id at its first publication: 16 bytes from a cryptographically secure
random source, encoded as unpadded base64url (22 characters). Every later publication of the gift
SHALL keep that share id, so every publication record of a gift carries the gift's share id and the
recipient URL never changes. Share ids SHALL be unique across gifts, enforced by a unique database
index on the gifts. The recipient URL SHALL be `/g/{shareId}`. A share id MUST NOT be derived from
the gift's internal id, its `publicId`, the owner or the content.

#### Scenario: Share id format

- **WHEN** a gift is published
- **THEN** its `shareId` matches `^[A-Za-z0-9_-]{22}$` and differs from its `publicId`

#### Scenario: Update keeps the share id

- **WHEN** a published gift is updated twice
- **THEN** its three publication records and the gift all carry the share id of the first
  publication

#### Scenario: Duplicate share id rejected by the database

- **WHEN** a second gift is written with an existing `shareId`
- **THEN** MongoDB rejects the write with a duplicate-key error

### Requirement: Idempotent publish

Each `Idempotency-Key` SHALL be unique within the `gift-publish` scope and SHALL be kept for 24
hours after a successful publish. The key is recorded only by a successful publish, so a request
that failed MAY be retried with the same key and a different `expectedRevision` or `planId`. A
repeated request with the key of a successful publish SHALL return `201` with the publication of
that request's revision only when it comes from the same signed-in user, for the same `publicId`,
with the same `expectedRevision` and the same `planId`. It does so even when the gift was updated
again since, or has expired since. In every other case it SHALL respond `409` with code `CONFLICT`
and publish nothing. Concurrent requests with the same key SHALL produce at most one publication.

#### Scenario: Lost response replayed

- **WHEN** the owner repeats a successful publish request with the same key and body within 24
  hours
- **THEN** the response is `201` with the same `shareId`, `publishedAt` and `revision`, and no
  second publication exists

#### Scenario: Replay after a later update

- **WHEN** the owner published revision `7` with key `K1` and revision `9` with key `K2`, and then
  repeats the request of `K1`
- **THEN** the response is `201` with `revision` `7` and the `publishedAt` of that publication, and
  the gift's current publication stays revision `9`

#### Scenario: Replay with a different body

- **WHEN** the owner reuses the key of a successful publish with another `expectedRevision` or
  another `planId`, or for another gift
- **THEN** the response is `409` with code `CONFLICT`

#### Scenario: Retry after a validation failure

- **WHEN** a publish fails with `400`, the owner fixes the content, and publishes again with the
  same key and the new revision
- **THEN** the publish is accepted

#### Scenario: Retry with another plan after a refusal

- **WHEN** a first publish on `free` fails with `PLAN_PHOTO_LIMIT_EXCEEDED`, and the owner retries
  with the same key on `standard` while the internal paid-plan grant is on
- **THEN** the publish is accepted with `planId` `standard`

#### Scenario: Double click

- **WHEN** two publish requests with the same key and body arrive at the same time
- **THEN** both responses are `201` with the same `shareId`, and exactly one publication exists

### Requirement: Published gift in the Studio

`/studio/{publicId}` SHALL show, when the gift is `published` and the request is authorized for it
under the draft access rules of `gift-draft-ownership`, a published panel above the editor of
`studio-editor`. The editor edits the gift's working copy (see "Editing a published gift"). The
panel SHALL show:

- the heading `Đã xuất bản`;
- the absolute share URL (the application origin followed by `/g/{shareId}`) in a read-only field
  labelled `Đường dẫn món quà`;
- a `Sao chép liên kết` button. It copies the URL and then reads `Đã sao chép`. When copying fails,
  the panel shows `Không sao chép được — hãy chọn đường dẫn và sao chép thủ công.`;
- a link `Mở món quà` to `/g/{shareId}`;
- the plan line `Gói {planName} · Người nhận mở được đến {expiry}.`, where `{planName}` is the
  name of the entitlement's plan in `gift-plans` and `{expiry}` is `expiresAt` formatted as
  `HH:mm dd/MM/yyyy` in the `Asia/Ho_Chi_Minh` time zone. Once `expiresAt` has passed, the line
  SHALL instead read `Món quà đã hết hạn lúc {expiry}. Người nhận không còn mở được.`;
- the status `Có thay đổi chưa cập nhật. Người nhận vẫn đang xem bản đã gửi trước đó.` while the
  gift has unpublished changes, and otherwise `Người nhận đang xem bản mới nhất.`. The status SHALL
  follow each successful save and each successful update without a page reload;
- the note `Ai có đường dẫn này đều mở được món quà. Chỉ chia sẻ với người nhận.`

The page SHALL autosave the working copy as for a draft (`studio-autosave`). For a gift in any
status other than `draft` or `published`, or for an unauthorized request, the page SHALL render the
not-found page.

#### Scenario: Owner reopens a published gift

- **WHEN** the owner opens `/studio/{publicId}` of a published gift without unpublished changes
- **THEN** the page shows `Đã xuất bản`, the share URL ending in `/g/{shareId}`,
  `Người nhận đang xem bản mới nhất.` and the editor with the gift's content

#### Scenario: Someone else opens the Studio URL

- **WHEN** a browser without the owner's session opens `/studio/{publicId}` of a published gift
- **THEN** the not-found page is rendered

#### Scenario: Copy the link

- **WHEN** the owner chooses `Sao chép liên kết` and the clipboard accepts the text
- **THEN** the clipboard holds the absolute share URL and the button reads `Đã sao chép`

#### Scenario: Unpublished changes shown after a save

- **WHEN** the owner edits a caption of a published gift and the autosave answers `200`
- **THEN** the panel shows `Có thay đổi chưa cập nhật. Người nhận vẫn đang xem bản đã gửi trước
đó.` without a reload

#### Scenario: Plan and expiry shown

- **WHEN** the owner opens a gift first published on `free` at `2026-10-08T10:00:00Z`
- **THEN** the panel shows `Gói Miễn phí · Người nhận mở được đến 17:00 22/10/2026.`

#### Scenario: Expired gift in the Studio

- **WHEN** the owner opens that gift after `2026-10-22T10:00:00Z`
- **THEN** the panel shows `Món quà đã hết hạn lúc 17:00 22/10/2026. Người nhận không còn mở
được.`, and the editor stays editable

### Requirement: Editing a published gift

While a gift is `published`, its signed-in owner SHALL be able to keep editing it. The gift's
`content` and `revision` SHALL act as a working copy that is saved through the draft API of
`gift-drafts`, previewed through `gift-preview` and given photos through the media routes of
`media-upload`, as for a draft. The working copy MUST NOT change what recipients receive:
`/g/{shareId}` and `GET /api/public-gifts/{shareId}` SHALL serve the gift's current publication only
(`public-gift-viewer`), until a publish of a newer revision replaces it (see "Immutable publication
snapshot"). The gift SHALL have unpublished changes exactly when its `revision` is greater than the
revision of its current publication.

A published gift always has an owner, so the anonymous draft cookie MUST NOT authorize anything
for it, and neither does a preview token beyond the preview page. The claim endpoint SHALL respond
`404` with code `NOT_FOUND` for a published gift. No edit SHALL modify or delete a publication
record. A photo that the current publication references SHALL stay available to recipients even
after the owner removes it from the working copy (`media-upload` "Asset deletion").

#### Scenario: Edit not visible to recipients

- **WHEN** the owner of a gift published at revision `7` changes `final-letter` and the save answers
  `200` with revision `8`
- **THEN** `GET /api/public-gifts/{shareId}` still returns the `final-letter` of revision `7`

#### Scenario: Update visible at the same link

- **WHEN** the owner then publishes with `expectedRevision` `8` and gets `201`
- **THEN** the same `/g/{shareId}` now plays the content of revision `8`

#### Scenario: Claim refused for a published gift

- **WHEN** a signed-in user sends the claim request for a published gift
- **THEN** the response is `404` with code `NOT_FOUND`, and the gift is unchanged

#### Scenario: Removed photo still shown to recipients

- **WHEN** the owner deletes, in the Studio, a photo that the current publication references, and
  saves the working copy without it
- **THEN** recipients still see that photo until the owner publishes the working copy
