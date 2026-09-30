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

The system SHALL authorize every draft read and update by combining all credentials the request presents (the signed-in user, the anonymous cookie, or both) in a single repository query. A draft SHALL be accessible when any of these is true: its owner is the signed-in user; the signed-in user has the role `admin`; or the draft has no owner and both the anonymous draft ID and the claim-token hash match the cookie. The check SHALL be applied atomically as part of the update write itself, not only before it.

#### Scenario: Signed-in creator keeps access to a pre-sign-in draft

- **WHEN** a creator signs in while still holding the anonymous cookie of an unclaimed draft
- **THEN** that draft can still be read and saved, based on the anonymous credentials

#### Scenario: Another creator is denied

- **WHEN** a signed-in creator who is not the owner, and who presents no matching anonymous credentials, requests the draft
- **THEN** access is denied

### Requirement: Opaque not-found for non-owners

The system MUST respond to unauthorized draft access exactly as it responds to a nonexistent draft: HTTP `404` with code `NOT_FOUND` and the message `Gift draft was not found.` for API routes, and the not-found page for `/studio/{publicId}`. A request that presents no credentials at all SHALL receive the same `404`. If an update fails its atomic write, the system SHALL re-read the draft through the same authorization rules. If the requester is no longer authorized, for example because ownership changed concurrently, the system SHALL respond `404` rather than reveal the current revision.

#### Scenario: Unauthorized read is indistinguishable

- **WHEN** a requester without matching credentials calls `GET /api/gifts/{publicId}` for an existing draft
- **THEN** the response is `404` with code `NOT_FOUND`, identical to the response for a nonexistent `publicId`

#### Scenario: Ownership changes during a save

- **WHEN** an anonymous save loses the race to a concurrent claim by another account
- **THEN** the response is `404` with code `NOT_FOUND`, not a `409` containing revision details

### Requirement: Claim an anonymous draft after sign-in

The system SHALL let a signed-in creator claim an anonymous draft through `POST /api/gifts/{publicId}/claim` with the strict JSON body `{}`. Without a session the system SHALL respond `401` with code `UNAUTHORIZED`. A claim SHALL succeed only when all of these are true: the request carries the draft's anonymous cookie, both credentials match, the draft still has no owner, and its status is `draft`. Otherwise the system SHALL respond `404` with code `NOT_FOUND`, including when the draft has already been claimed. A successful claim SHALL, in one atomic write, set the owner to the signed-in user, clear the anonymous draft ID and claim-token hash, and update `updatedAt` without changing `revision`. It SHALL then respond `200` with a DTO whose `ownerKind` is `user`. The studio page SHALL offer the claim action for an anonymous draft when the viewer is signed in, and otherwise a sign-in link to `/auth/sign-in?next=/studio/{publicId}`.

#### Scenario: Successful claim

- **WHEN** a signed-in creator with the matching anonymous cookie posts `{}` to `/api/gifts/{publicId}/claim`
- **THEN** the response is `200` with `data.gift.ownerKind` `user`, and the draft's revision is unchanged

#### Scenario: Claim without a session

- **WHEN** a request without a session posts to `/api/gifts/{publicId}/claim`
- **THEN** the response is `401` with code `UNAUTHORIZED`

#### Scenario: Claim with a wrong or missing claim token

- **WHEN** a signed-in creator posts a claim without the anonymous cookie, or with a claim token that does not match
- **THEN** the response is `404` with code `NOT_FOUND`, and ownership is unchanged

### Requirement: Anonymous access revoked after claim

After a draft is claimed, its former anonymous credentials MUST NOT grant any access to it. Reads and saves using only the anonymous cookie SHALL receive `404` with code `NOT_FOUND`, and replaying the original create request with its `Idempotency-Key` SHALL receive `409` with code `CONFLICT`. The claiming account SHALL keep full access after signing out and back in. The server does not clear the anonymous cookie on claim; the cookie simply no longer matches the draft.

#### Scenario: Old idempotency key cannot recover a claimed draft

- **WHEN** the original anonymous create request is replayed with the same `Idempotency-Key` after the draft was claimed
- **THEN** the response is `409` with code `CONFLICT`, and no draft data or cookie is returned

#### Scenario: Anonymous cookie alone after claim

- **WHEN** a request without a session presents the former anonymous cookie for a claimed draft
- **THEN** reading or saving the draft returns `404` with code `NOT_FOUND`
