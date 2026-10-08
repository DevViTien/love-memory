## MODIFIED Requirements

### Requirement: Preview link issuance

The system SHALL accept `POST /api/gifts/{publicId}/preview` with a strict JSON body `{}`. The
checks and responses are:

- The request SHALL pass the guards of `mutation-request-guards` in their order: media type,
  origin, path, then the rate limit of scope `gift-preview`, then the body.
- The gift SHALL be authorized with the draft access rules of `gift-draft-ownership`.
- A malformed `publicId`, a request without credentials, a gift the caller cannot access, and a
  gift whose status is neither `draft` nor `published` SHALL respond `404` with code `NOT_FOUND`
  and the message `Gift draft was not found.`.
- A gift whose bound template version can no longer be resolved for editing SHALL respond `409`
  with code `CONFLICT`, as saving it does.
- On success the system SHALL create a preview token and respond `201` with
  `data` `{ url, expiresAt }`. `url` is `/preview/{token}`, and `expiresAt` is an ISO 8601
  timestamp 1800 seconds after issuance.

For a `published` gift the preview shows its working copy (`gift-publishing` "Editing a published
gift"), so the owner can check unpublished changes before updating the gift.

The token SHALL be 32 bytes from a cryptographically secure random source, encoded as unpadded
base64url (43 characters). The system SHALL store only the token's SHA-256 hash (lowercase hex),
with the gift's internal id, `createdAt` and `expiresAt`. It MUST NOT store, return in any other
form or log the token itself. Each successful request SHALL create a new token. Earlier tokens stay
valid until they expire.

#### Scenario: Owner requests a preview link

- **WHEN** the owner of draft `{publicId}` sends `POST /api/gifts/{publicId}/preview` with body `{}`
- **THEN** the response is `201` with `data.url` matching `/preview/` followed by 43 base64url
  characters, and `data.expiresAt` 30 minutes later
- **AND** the stored record holds the SHA-256 hash of the token, not the token

#### Scenario: Non-owner denied opaquely

- **WHEN** a requester without matching credentials sends the request for an existing draft
- **THEN** the response is `404` with code `NOT_FOUND`, identical to the response for a
  nonexistent `publicId`, and no token is created

#### Scenario: Published or deleted gift

- **WHEN** the owner requests a preview link for a published gift, and for a gift whose status is
  `deleted`
- **THEN** the published gift gets `201` with a preview link of its working copy, and the deleted
  gift gets `404` with code `NOT_FOUND` and no token is created

#### Scenario: Rate limit exceeded

- **WHEN** the same subject sends a 31st request within one 600-second `gift-preview` window
- **THEN** the response is `429` with code `RATE_LIMITED`, `error.details.retryAfterSeconds` and a
  matching `Retry-After` header, and no token is created

#### Scenario: Unexpected body or media type

- **WHEN** the request has `Content-Type: text/plain`, or the body `{ "ttl": 99999 }`
- **THEN** the response is `415` or `400` with code `VALIDATION_ERROR` respectively, and no token
  is created

#### Scenario: Unexpected failure

- **WHEN** the database throws while the token is stored
- **THEN** the response is `500` with code `INTERNAL_ERROR`, and the log entry holds only an event
  name and the request id

### Requirement: Opening a preview link

The system SHALL serve `/preview/{token}` as follows. It SHALL look up the SHA-256 hash of the path
token among the stored tokens whose `expiresAt` is later than the current time. The expiry is
checked on read, whatever the database's TTL deletion has done. It SHALL then read the bound gift
only when its status is `draft` or `published`, and render the gift's current content at the time
of the request: the last saved content of a draft, or the working copy of a published gift. That
is not a snapshot taken when the link was issued, and for a published gift it is not the content
recipients receive.

A valid token SHALL be the only credential the page needs. No session or cookie is required.

The page SHALL render the not-found page whenever any of these holds:

- the token is not exactly 43 base64url characters (then without any database access);
- no stored token matches;
- the token has expired;
- the gift no longer exists or its status is neither `draft` nor `published`;
- its template version can no longer be resolved.

The not-found page SHALL be identical in all these cases and SHALL be answered with HTTP status
`404`; the token check runs before any part of the response is streamed.

#### Scenario: Latest content shown

- **WHEN** the creator issues a preview link, then changes `receiver-name` in the Studio and the
  change is saved, then opens the link
- **THEN** the preview uses the changed `receiver-name`

#### Scenario: Preview link survives the first publish

- **WHEN** a preview link issued for a draft is opened, before it expires, after the draft was
  published and its working copy changed
- **THEN** the preview renders the working copy, not the published content

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
- **THEN** the working copy is rendered when the gift is `published`, and the same not-found page is
  rendered for any other status

#### Scenario: Link opened on another device

- **WHEN** the creator opens a valid preview link in a browser with no session and no draft cookie
- **THEN** the preview is rendered
