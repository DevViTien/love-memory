# Gift Draft Ownership

## Purpose

Defines who owns a gift draft and how that ownership is proven. A creator can start a draft without an account, protected by a secret browser cookie, and later claim it into their account after signing in. This capability covers anonymous draft credentials, authorization of draft access, claiming, and what happens to anonymous access after a claim. Draft content and revisions are specified in `gift-drafts`; creator sign-in is specified in `creator-authentication`.

## Requirements

### Requirement: Anonymous draft cookie

When a creator without a session creates a draft, the system SHALL issue anonymous draft credentials in a cookie named `love_memory_anonymous_draft` on the create response. The cookie value is `<anonymousDraftId>.<claimToken>`, and its attributes are `Path=/`, `Max-Age=2592000`, `HttpOnly`, and `SameSite=Lax`, plus `Secure` in production. If the request already carries a valid cookie, the system SHALL reuse that identity for the new draft and set the cookie again. A cookie value that does not match the expected format SHALL be ignored, as if no cookie were present. A creator who is signed in SHALL receive a draft owned by their account and no anonymous cookie.

#### Scenario: Anonymous create sets the cookie

- **WHEN** a request without a session successfully calls `POST /api/gifts`
- **THEN** the response sets `love_memory_anonymous_draft` with `Path=/`, `Max-Age=2592000`, `HttpOnly`, and `SameSite=Lax`
- **AND** `data.gift.ownerKind` is `anonymous`

#### Scenario: Signed-in create sets no anonymous cookie

- **WHEN** a signed-in creator successfully calls `POST /api/gifts`
- **THEN** `data.gift.ownerKind` is `user`, and no `love_memory_anonymous_draft` cookie is set

#### Scenario: Malformed cookie is ignored

- **WHEN** a request carries a `love_memory_anonymous_draft` value that is not a UUID followed by `.` and a 43-character base64url token
- **THEN** the request is treated as having no anonymous credentials

### Requirement: Anonymous credential entropy and storage

The anonymous draft ID SHALL be a UUID, and the claim token SHALL be 256 bits encoded as 43 base64url characters. Both SHALL be derived with keyed HMAC-SHA-256 from the create request's `Idempotency-Key` and the server auth secret, using a separate purpose label for each, so a replayed create yields the same credentials. The server SHALL store only the draft ID and the claim token's SHA-256 hash (64 lowercase hex characters), never the claim token itself. Every draft MUST have exactly one of two ownership shapes: anonymous (no owner, with both the anonymous draft ID and the claim-token hash) or owned (an owner, with neither anonymous credential).

#### Scenario: Replay recovers the same credentials

- **WHEN** a lost anonymous create response is retried with the same `Idempotency-Key`
- **THEN** the replay response sets the same `love_memory_anonymous_draft` value as the original

#### Scenario: Ownership invariant enforced

- **WHEN** a draft would be stored with an owner and a leftover anonymous credential, or with no owner and only one anonymous credential
- **THEN** the draft is rejected as invalid and is not persisted

### Requirement: Draft authorization

The system SHALL authorize every draft read and update by combining all credentials the request presents (the signed-in user, the anonymous cookie, or both) in a single repository query. The only exceptions are the preview read and publishing, described below. A draft SHALL be accessible when either of these is true: its owner is the signed-in user; or the draft has no owner and both the anonymous draft ID and the claim-token hash match the cookie. The user's role, including `admin`, MUST NOT grant access to another creator's draft. The check SHALL be applied atomically as part of the update write itself, not only before it.

A valid, unexpired preview token (see `gift-preview`) SHALL be the only other credential. It grants read-only access to the current content of the one draft it was issued for, and only through the preview page. That read uses two queries, each filtering by its own credential:

- a token lookup by the token's hash, filtered on `expiresAt` later than now;
- a read of the bound gift by its id, filtered on status `draft`.

The preview payload MAY embed short-lived signed download URLs of that draft's `ready` asset derivatives, as specified in `viewer-payload`. The token MUST NOT grant anything else: no draft API read or update, no claim, no media operation, no asset listing and no Studio access, and it MUST NOT be accepted by those routes. Issuing a preview token SHALL require the draft access defined in the first paragraph. Every other guarantee of this requirement also applies to the preview read: the role grants nothing, and the check happens inside the query filter.

Publishing a draft (see `gift-publishing`) SHALL be authorized by the signed-in user alone: the draft's owner MUST be that user, checked inside the query filter of both the lookup and the publish write. The anonymous cookie MUST NOT authorize publishing, even when its credentials match an unclaimed draft; such a draft must be claimed first. A preview token MUST NOT authorize publishing either.

#### Scenario: Signed-in creator keeps access to a pre-sign-in draft

- **WHEN** a creator signs in while still holding the anonymous cookie of an unclaimed draft
- **THEN** that draft can still be read and saved, based on the anonymous credentials

#### Scenario: Another creator is denied

- **WHEN** a signed-in creator who is not the owner, and who presents no matching anonymous credentials, requests the draft
- **THEN** access is denied

#### Scenario: Admin role grants no draft access

- **WHEN** a signed-in user with role `admin` who does not own a draft requests it
- **THEN** the response is `404` with code `NOT_FOUND`

#### Scenario: Preview token does not unlock the draft API

- **WHEN** a requester who holds only a valid preview link for a draft calls `GET /api/gifts/{publicId}`, `PATCH /api/gifts/{publicId}` or opens `/studio/{publicId}`
- **THEN** the API answers `404` with code `NOT_FOUND` and the Studio renders the not-found page

#### Scenario: Anonymous credentials cannot publish

- **WHEN** a signed-in creator whose anonymous cookie matches an unclaimed draft sends `POST /api/gifts/{publicId}/publish` for it
- **THEN** the response is `404` with code `NOT_FOUND`, and the draft can still be read and saved with the same cookie

### Requirement: Opaque not-found for non-owners

The system MUST respond to unauthorized draft access exactly as it responds to a nonexistent draft: HTTP `404` with code `NOT_FOUND` and the message `Gift draft was not found.` for API routes, and the not-found page for `/studio/{publicId}`. A request that presents no credentials at all SHALL receive the same `404`. If an update fails its atomic write, the system SHALL re-read the draft through the same authorization rules. If the requester is no longer authorized, for example because ownership changed concurrently, the system SHALL respond `404` rather than reveal the current revision.

#### Scenario: Unauthorized read is indistinguishable

- **WHEN** a requester without matching credentials calls `GET /api/gifts/{publicId}` for an existing draft
- **THEN** the response is `404` with code `NOT_FOUND`, identical to the response for a nonexistent `publicId`

#### Scenario: Ownership changes during a save

- **WHEN** an anonymous save loses the race to a concurrent claim by another account
- **THEN** the response is `404` with code `NOT_FOUND`, not a `409` containing revision details

### Requirement: Claim an anonymous draft after sign-in

The system SHALL let a signed-in creator claim an anonymous draft through `POST /api/gifts/{publicId}/claim` with the strict JSON body `{}`. Without a session the system SHALL respond `401` with code `UNAUTHORIZED`. A claim SHALL succeed only when all of these are true: the request carries the draft's anonymous cookie, both credentials match, the draft still has no owner, and its status is `draft`. Otherwise the system SHALL respond `404` with code `NOT_FOUND`, including when the draft has already been claimed. A successful claim SHALL, in one atomic write, set the owner to the signed-in user, clear the anonymous draft ID and claim-token hash, and update `updatedAt` without changing `revision`. It SHALL then respond `200` with a DTO whose `ownerKind` is `user`.

The studio page SHALL claim an anonymous draft automatically when a signed-in viewer opens `/studio/{publicId}` and the request carries that draft's matching anonymous cookie, so that a creator who returns from the sign-in link does not need a second step. The automatic claim SHALL use the same conditions and the same atomic write as the claim endpoint, SHALL be idempotent, and SHALL happen before the page renders, which then shows the draft as owned (`ownerKind` `user`). When the automatic claim does not succeed, the page SHALL render the draft as it is and offer the claim action. For an anonymous draft opened without a session, the studio page SHALL offer a sign-in link to `/auth/sign-in?next=/studio/{publicId}`.

#### Scenario: Successful claim

- **WHEN** a signed-in creator with the matching anonymous cookie posts `{}` to `/api/gifts/{publicId}/claim`
- **THEN** the response is `200` with `data.gift.ownerKind` `user`, and the draft's revision is unchanged

#### Scenario: Claim without a session

- **WHEN** a request without a session posts to `/api/gifts/{publicId}/claim`
- **THEN** the response is `401` with code `UNAUTHORIZED`

#### Scenario: Claim with a wrong or missing claim token

- **WHEN** a signed-in creator posts a claim without the anonymous cookie, or with a claim token that does not match
- **THEN** the response is `404` with code `NOT_FOUND`, and ownership is unchanged

#### Scenario: Returning from the sign-in link in the same browser

- **WHEN** a creator who started an anonymous draft in this browser signs in through the magic link and lands on `/studio/{publicId}`
- **THEN** the draft is claimed before the page renders, the page shows it as owned by the account, and `Xuất bản` needs no separate claim action
- **AND** the draft's revision is unchanged

#### Scenario: Automatic claim lost to another account

- **WHEN** the draft was claimed by another account between the page's read and its automatic claim
- **THEN** ownership is unchanged by this request and the page does not show the draft as owned by the viewer

### Requirement: Anonymous access revoked after claim

After a draft is claimed, its former anonymous credentials MUST NOT grant any access to it. Reads and saves using only the anonymous cookie SHALL receive `404` with code `NOT_FOUND`, and replaying the original create request with its `Idempotency-Key` SHALL receive `409` with code `CONFLICT`. The claiming account SHALL keep full access after signing out and back in. The server does not clear the anonymous cookie on claim; the cookie simply no longer matches the draft.

#### Scenario: Old idempotency key cannot recover a claimed draft

- **WHEN** the original anonymous create request is replayed with the same `Idempotency-Key` after the draft was claimed
- **THEN** the response is `409` with code `CONFLICT`, and no draft data or cookie is returned

#### Scenario: Anonymous cookie alone after claim

- **WHEN** a request without a session presents the former anonymous cookie for a claimed draft
- **THEN** reading or saving the draft returns `404` with code `NOT_FOUND`

### Requirement: Studio not-found guidance

The not-found page of `/studio/{publicId}` SHALL be one page for every cause (unknown draft, no access, another owner, a status other than `draft` or `published`). It MUST NOT reveal whether the draft exists. It SHALL explain the most common cause after a sign-in in another browser, with the heading `Không mở được bản nháp này` and the text `Bản nháp tạo khi chưa đăng nhập chỉ mở được trên trình duyệt đã tạo ra nó. Hãy mở lại trình duyệt hoặc điện thoại bạn đã dùng để tạo quà, đăng nhập ở đó để lưu quà vào tài khoản.`, and SHALL link to `/templates`.

#### Scenario: Magic link opened in another browser

- **WHEN** a creator signs in through a magic link that opened in a browser without the draft's anonymous cookie and lands on `/studio/{publicId}`
- **THEN** the page shows `Không mở được bản nháp này` with the explanation, and no draft content

#### Scenario: Unknown draft

- **WHEN** anyone opens `/studio/{publicId}` for a draft that does not exist
- **THEN** the same page is shown as for a draft the requester cannot access
