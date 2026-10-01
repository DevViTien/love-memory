## MODIFIED Requirements

### Requirement: Opening a preview link

The system SHALL serve `/preview/{token}` as follows. It SHALL look up the SHA-256 hash of the path
token among the stored tokens whose `expiresAt` is later than the current time. The expiry is
checked on read, whatever the database's TTL deletion has done. It SHALL then read the bound gift
only when its status is `draft`, and render the gift's current draft content at the time of the
request. That is the last saved content, not a snapshot taken when the link was issued.

A valid token SHALL be the only credential the page needs. No session or cookie is required.

The page SHALL render the not-found page whenever any of these holds:

- the token is not exactly 43 base64url characters (then without any database access);
- no stored token matches;
- the token has expired;
- the gift no longer exists or is not a `draft`;
- its template version can no longer be resolved.

The not-found page SHALL be identical in all these cases and SHALL be answered with HTTP status
`404`; the token check runs before any part of the response is streamed.

#### Scenario: Latest content shown

- **WHEN** the creator issues a preview link, then changes `receiver-name` in the Studio and the
  change is saved, then opens the link
- **THEN** the preview uses the changed `receiver-name`

#### Scenario: Unknown or malformed token

- **WHEN** a visitor opens `/preview/` followed by 43 random base64url characters, or `/preview/abc`
- **THEN** the not-found page `Kỷ niệm này chưa tồn tại.` is rendered with HTTP status `404` and
  `X-Robots-Tag: noindex`

#### Scenario: Expired token

- **WHEN** a visitor opens a preview link 1801 seconds after it was issued, even though the TTL
  monitor has not yet deleted the record
- **THEN** the same not-found page is rendered

#### Scenario: Gift no longer a draft

- **WHEN** a valid preview link is opened after the gift left the `draft` status
- **THEN** the same not-found page is rendered

#### Scenario: Link opened on another device

- **WHEN** the creator opens a valid preview link in a browser with no session and no draft cookie
- **THEN** the preview is rendered
