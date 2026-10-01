## MODIFIED Requirements

### Requirement: Share link access

A share id SHALL be the only credential a recipient needs. No session, cookie or account is
required, and a signed-in session grants nothing more. A share link SHALL be live only while its
gift's status is `published`, the gift's access policy is `unlisted`, and the gift's `shareId`
equals it. A share id SHALL be treated as not found, with identical answers, when any of these
holds:

- it is not exactly 22 base64url characters (then without any database access);
- no gift has that `shareId`;
- the gift is not `published`, or its access policy is not `unlisted`;
- the gift's publication record or its template version can no longer be read.

The page SHALL answer every not-found case with HTTP status `404`; the liveness check runs before
any part of the response is streamed, so a missing gift is never answered `200`.

The gift lookup SHALL filter by the share id (as an exact string), the `published` status and the
`unlisted` access mode inside the database query, and SHALL be served by the unique share id
index. Access policies other than `unlisted` fail closed until they are specified. The page and the
payload endpoint SHALL apply the same liveness check, including the publication record and the
template version, so that they never disagree on whether a share link exists.

#### Scenario: Anonymous recipient

- **WHEN** a browser with no cookies opens the share link of a published gift
- **THEN** the page renders the envelope, and opening it shows the gift

#### Scenario: Unknown share id

- **WHEN** a browser opens `/g/` followed by 22 random base64url characters
- **THEN** the not-found page `Món quà không tồn tại hoặc đã được thu hồi.` is rendered with HTTP
  status `404` and `X-Robots-Tag: noindex`

#### Scenario: Malformed share id

- **WHEN** a browser opens `/g/abc` or `/g/` followed by 23 characters
- **THEN** the same not-found page is rendered, and no database query is made

#### Scenario: Draft is never reachable

- **WHEN** a share id is requested for a gift that is still a `draft`
- **THEN** the same not-found page is rendered

#### Scenario: Unsupported access policy fails closed

- **WHEN** a `published` gift's access policy is `password` or `scheduled`
- **THEN** its share link renders the same not-found page, and the payload endpoint answers `404`

#### Scenario: Missing publication record

- **WHEN** a `published` gift has a `shareId` but no matching publication record
- **THEN** the page renders the not-found page and the payload endpoint answers `404`, never an
  envelope that cannot be opened
