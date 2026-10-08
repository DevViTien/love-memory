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
- the gift's current publication record, the one whose revision equals the gift's
  `publishedRevision`, or its template version can no longer be read.

The page SHALL answer every not-found case with HTTP status `404`; the liveness check runs before
any part of the response is streamed, so a missing gift is never answered `200`.

The gift lookup SHALL filter by the share id (as an exact string), the `published` status and the
`unlisted` access mode inside the database query, and SHALL be served by the unique share id
index. The current publication SHALL be read by the gift's id and `publishedRevision`, and its
share id SHALL equal the gift's. Superseded publications of the gift MUST NOT be served. Access
policies other than `unlisted` fail closed until they are specified. The page and the payload
endpoint SHALL apply the same liveness check, including the current publication record and the
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

- **WHEN** a `published` gift has a `shareId` but no publication record for its
  `publishedRevision`
- **THEN** the page renders the not-found page and the payload endpoint answers `404`, never an
  envelope that cannot be opened, and never an older publication

### Requirement: Public payload endpoint

The system SHALL answer `GET /api/public-gifts/{shareId}` for a live share link with `200` and
`data.viewer` holding exactly `artifactUrl`, `payload`, `assets`, `assetsExpireAt`, `audioUrl` and
`fields`. It MUST NOT include `issues`. The value SHALL be the output of the viewer payload
transformation of `viewer-payload`, built at request time from:

- the manifest of the current publication's `templateId` and `templateVersion`;
- the current publication's stored content, not the gift's working copy;
- the gift's asset records, so only `ready` assets of the gift and field that the current
  publication references get signed URLs, including assets detached from the working copy;
- the audio catalog;
- the current publication's `artifactContentHash` as the expected `contentHash`.

When the registered artifact no longer matches that hash, `artifactUrl` SHALL be `null`, and the
gift viewer shows the static rendering. The response SHALL use the standard envelope of
`mutation-request-guards`, with `Cache-Control: no-store`. A share id that is not found SHALL
respond `404` with code `NOT_FOUND` and the message `Gift was not found.`, identical in every case
of "Share link access". An unexpected failure SHALL respond `500` with code `INTERNAL_ERROR`, and
the log entry SHALL hold only an event name and the request id, never the share id, content or
URLs.

#### Scenario: Payload of the snapshot

- **WHEN** a published `memory-box` `1.1.0` gift is requested
- **THEN** the response is `200`, `data.viewer.artifactUrl` is the artifact of `1.1.0` with the
  stored `artifactContentHash`, `data.viewer.payload` equals the current publication's content,
  `data.viewer.assets` maps each photo's asset id to a signed URL, and there is no `issues` key

#### Scenario: Same as the preview

- **WHEN** a draft is previewed and then published without further edits
- **THEN** the public `payload`, `fields`, `artifactUrl`, `audioUrl` and the set of `assets` keys
  equal those of the preview built for the same revision

#### Scenario: Working copy is not served

- **WHEN** the owner of a gift published at revision `7` has saved its working copy at revision
  `10`
- **THEN** `data.viewer.payload` equals the content of the publication of revision `7`

#### Scenario: Updated gift

- **WHEN** a gift published at revision `7` is updated to revision `10`
- **THEN** the next request returns the content and asset URLs of the publication of revision `10`

#### Scenario: Detached photo still signed

- **WHEN** a photo of the current publication was detached from the working copy
- **THEN** `data.viewer.assets` still maps that photo's asset id to a signed URL

#### Scenario: Artifact bytes changed

- **WHEN** the registered artifact of the publication's version has a `contentHash` different from
  `artifactContentHash`
- **THEN** `data.viewer.artifactUrl` is `null`, and the rest of the payload is returned

#### Scenario: Not found

- **WHEN** the endpoint is called with an unknown, malformed or not published share id
- **THEN** the response is `404` with code `NOT_FOUND` and `Cache-Control: no-store`

#### Scenario: Unexpected failure

- **WHEN** URL signing throws while the payload is built
- **THEN** the response is `500` with code `INTERNAL_ERROR`, and the log entry holds only an event
  name and the request id
