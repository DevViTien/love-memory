## MODIFIED Requirements

### Requirement: Draft authorization

The system SHALL authorize every draft read and update by combining all credentials the request presents (the signed-in user, the anonymous cookie, or both) in a single repository query. A draft SHALL be accessible when either of these is true: its owner is the signed-in user; or the draft has no owner and both the anonymous draft ID and the claim-token hash match the cookie. The user's role, including `admin`, MUST NOT grant access to another creator's draft. The check SHALL be applied atomically as part of the update write itself, not only before it.

#### Scenario: Signed-in creator keeps access to a pre-sign-in draft

- **WHEN** a creator signs in while still holding the anonymous cookie of an unclaimed draft
- **THEN** that draft can still be read and saved, based on the anonymous credentials

#### Scenario: Another creator is denied

- **WHEN** a signed-in creator who is not the owner, and who presents no matching anonymous credentials, requests the draft
- **THEN** access is denied

#### Scenario: Admin role grants no draft access

- **WHEN** a signed-in user with role `admin` who does not own a draft requests it
- **THEN** the response is `404` with code `NOT_FOUND`
