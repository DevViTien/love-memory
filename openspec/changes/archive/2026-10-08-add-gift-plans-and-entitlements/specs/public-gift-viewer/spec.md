# Spec Delta

## MODIFIED Requirements

### Requirement: Share link access

A share id SHALL be the only credential a recipient needs. No session, cookie or account is
required, and a signed-in session grants nothing more. A share link SHALL be live only while its
gift's status is `published`, the gift's access policy is `unlisted`, the gift's `shareId` equals
it, and the server time is before the gift's `expiresAt` (`gift-plans` "Entitlement expiry"). A
share id SHALL be treated as not found, with identical answers, when any of these holds:

- it is not exactly 22 base64url characters (then without any database access);
- no gift has that `shareId`;
- the gift is not `published`, or its access policy is not `unlisted`;
- the gift's `expiresAt` is missing or not later than the server time of the request;
- the gift's current publication record, the one whose revision equals the gift's
  `publishedRevision`, or its template version can no longer be read.

The page SHALL answer every not-found case with HTTP status `404`; the liveness check runs before
any part of the response is streamed, so a missing gift is never answered `200`. The not-found page
SHALL read `Món quà không tồn tại, đã hết hạn hoặc đã được thu hồi.`

The gift lookup SHALL filter by the share id (as an exact string), the `published` status, the
`unlisted` access mode and an `expiresAt` later than the server time inside the database query, and
SHALL be served by the unique share id index. The server time SHALL be read once per request, and
the client's clock MUST NOT be used. The current publication SHALL be read by the gift's id and
`publishedRevision`, and its share id SHALL equal the gift's. Superseded publications of the gift
MUST NOT be served. Access policies other than `unlisted` fail closed until they are specified. The
page and the payload endpoint SHALL apply the same liveness check, including the expiry, the
current publication record and the template version, so that they never disagree on whether a share
link exists.

#### Scenario: Anonymous recipient

- **WHEN** a browser with no cookies opens the share link of a published gift
- **THEN** the page renders the envelope, and opening it shows the gift

#### Scenario: Unknown share id

- **WHEN** a browser opens `/g/` followed by 22 random base64url characters
- **THEN** the not-found page `Món quà không tồn tại, đã hết hạn hoặc đã được thu hồi.` is rendered
  with HTTP status `404` and `X-Robots-Tag: noindex`

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

#### Scenario: Expired gift

- **WHEN** a `published` gift whose `expiresAt` is earlier than the server time is requested, and
  its stored status is still `published`
- **THEN** the page renders the same not-found page with HTTP status `404`, and the payload
  endpoint answers `404` with code `NOT_FOUND`, identical to an unknown share id

#### Scenario: Envelope rendered before expiry, opened after

- **WHEN** the page was rendered before `expiresAt`, and the recipient chooses `Mở quà` after it
- **THEN** the payload request answers `404`, and the gift viewer shows its retry message and no
  content

### Requirement: Public gift page

The system SHALL serve `/g/{shareId}` for a live share link as a page that holds the gift viewer of
`gift-viewer` with a deferred source. The server-rendered page MUST NOT contain gift content: no
text, no field value, no asset id and no URL of an asset or the audio track. The envelope heading
and the `Mở quà` control of the gift viewer SHALL be the only gift-related content before the tap.
Choosing `Mở quà` SHALL load the viewer payload from `GET /api/public-gifts/{shareId}` without
credentials and with no caching, then play the gift. A failed load SHALL show the gift viewer's
retry message. When the gift viewer needs fresh asset URLs, it SHALL call the same endpoint again.

When the gift's entitlement has `watermark` `true` (`gift-plans`), the page SHALL show the static
text `Tạo bằng LoveMemory` over the gift frame: a corner of the frame that holds the gift viewer,
outside the template's iframe, before and after the tap. It SHALL NOT capture pointer input, so it
never blocks the template or the viewer's controls. When `watermark` is `false`, the page SHALL NOT
show it. The watermark MUST NOT be sent to the template, and the payload endpoint's response SHALL
NOT change because of it.

The page title SHALL be `Một món quà dành cho bạn · LoveMemory`. The page description and Open
Graph title and description SHALL be the generic
`Ai đó đã gửi cho bạn một món quà kỷ niệm trên LoveMemory.` and `Một món quà dành cho bạn`, with no
Open Graph image. Metadata MUST NOT contain gift text, the recipient's name or the creator's
identity. The page SHALL declare `robots` `noindex, nofollow`.

The page MUST NOT produce preview issues, and it MUST NOT show the preview controls.

#### Scenario: Envelope without content

- **WHEN** the page of a published gift whose `receiver-name` is `Minh Thư` is fetched without
  running scripts
- **THEN** the HTML contains `Bạn có một món quà` and `Mở quà`, and contains neither `Minh Thư`,
  nor an asset id, nor a `/api/local-storage/` or Blob URL, nor `/audio-library/`

#### Scenario: Open on tap

- **WHEN** the recipient chooses `Mở quà`
- **THEN** exactly one `GET /api/public-gifts/{shareId}` is sent, and the gift plays from its
  opening scene with its photos

#### Scenario: Metadata stays generic

- **WHEN** the page of any published gift is served
- **THEN** the document title is `Một món quà dành cho bạn · LoveMemory`, and no `<meta>` element
  holds gift text

#### Scenario: Refresh of expired asset URLs

- **WHEN** the template fails more than 300 seconds after the payload was loaded, so the static
  fallback's asset URLs have expired
- **THEN** the gift viewer calls `GET /api/public-gifts/{shareId}` once more, and the fallback shows
  the photos with the fresh URLs without returning to the envelope

#### Scenario: Gift revoked while the envelope is open

- **WHEN** the page was rendered, and the load on `Mở quà` answers `404`
- **THEN** the gift viewer shows its retry message and no content

#### Scenario: Free gift carries the watermark

- **WHEN** a recipient opens the share link of a gift published on `free`
- **THEN** `Tạo bằng LoveMemory` is visible over the envelope and stays visible while the gift
  plays, and taps on the gift still reach the template

#### Scenario: Standard gift has no watermark

- **WHEN** a recipient opens the share link of a gift published on `standard`
- **THEN** the page contains no `Tạo bằng LoveMemory`
