# Spec Delta

## MODIFIED Requirements

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
