# public-gift-viewer Specification

## Purpose

Lets a recipient open a published gift from its share link on any browser, without an account. It
covers the `/g/{shareId}` page with an envelope that carries no gift content, the public payload
endpoint that returns the published snapshot through the shared viewer payload, response
protection, rate limiting and the opaque not-found answer.

## Requirements

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

### Requirement: Public gift page

The system SHALL serve `/g/{shareId}` for a live share link as a page that holds the gift viewer of
`gift-viewer` with a deferred source. The server-rendered page MUST NOT contain gift content: no
text, no field value, no asset id and no URL of an asset or the audio track. The envelope heading
and the `Mở quà` control of the gift viewer SHALL be the only gift-related content before the tap.
Choosing `Mở quà` SHALL load the viewer payload from `GET /api/public-gifts/{shareId}` without
credentials and with no caching, then play the gift. A failed load SHALL show the gift viewer's
retry message. When the gift viewer needs fresh asset URLs, it SHALL call the same endpoint again.

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

### Requirement: Public payload endpoint

The system SHALL answer `GET /api/public-gifts/{shareId}` for a live share link with `200` and
`data.viewer` holding exactly `artifactUrl`, `payload`, `assets`, `assetsExpireAt`, `audioUrl` and
`fields`. It MUST NOT include `issues`. The value SHALL be the output of the viewer payload
transformation of `viewer-payload`, built at request time from:

- the manifest of the publication's `templateId` and `templateVersion`;
- the publication's stored content, not the gift's current fields;
- the gift's asset records, so only `ready` assets of the gift and field get signed URLs;
- the audio catalog;
- the publication's `artifactContentHash` as the expected `contentHash`.

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
  stored `artifactContentHash`, `data.viewer.payload` equals the publication's content,
  `data.viewer.assets` maps each photo's asset id to a signed URL, and there is no `issues` key

#### Scenario: Same as the preview

- **WHEN** a draft is previewed and then published without further edits
- **THEN** the public `payload`, `fields`, `artifactUrl`, `audioUrl` and the set of `assets` keys
  equal those of the preview built for the same revision

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

### Requirement: Public read rate limit

`GET /api/public-gifts/{shareId}` SHALL be rate limited after the share id format check and before
any database lookup of the gift. Each request SHALL be charged to two counters, and it SHALL be
rejected when either is over its limit:

| Scope                 | Subject                   | Limit                        |
| --------------------- | ------------------------- | ---------------------------- |
| `public-gift-read`    | network subject + shareId | 60 requests per 600 seconds  |
| `public-gift-read-ip` | network subject           | 600 requests per 600 seconds |

The per-link counter bounds retries on one gift without letting one network block other gifts. The
looser per-network cap bounds scanning across many links. This keeps many recipients behind one
carrier-grade NAT address, common on Vietnamese mobile networks, from sharing one small budget.

The network subject SHALL come from the first value of the trusted `x-vercel-forwarded-for` header
when it is a valid IP address of at most 64 characters:

- an IPv4 address is used as is;
- an IPv6 address is reduced to its `/64` prefix, because one device or household usually holds a
  whole `/64`.

Otherwise the subject is the shared `unidentified` subject, whose counters allow five times each
limit. The session and the anonymous draft cookie MUST NOT be used as the subject. Counters SHALL
use the same storage, atomic windows and keyed subject hashing as the mutation rate limits, so
neither the address nor the share id is stored in plaintext. A request over a limit SHALL respond
`429` with code `RATE_LIMITED`, `error.details.retryAfterSeconds` and a matching `Retry-After`
header.

#### Scenario: Public read limit exceeded for one link

- **WHEN** one client behind `x-vercel-forwarded-for: 203.0.113.10` sends 61 requests for the same
  share id within one 600-second window
- **THEN** the 61st response is `429` with code `RATE_LIMITED` and a `Retry-After` header, and no
  URL is signed for it

#### Scenario: Shared address opening different gifts

- **WHEN** 30 recipients behind the same carrier-grade NAT address `203.0.113.10` each open a
  different gift 3 times within one 600-second window
- **THEN** every request succeeds

#### Scenario: Scanning many links from one address

- **WHEN** one address sends 601 requests for different share ids within one 600-second window
- **THEN** the 601st response is `429` with code `RATE_LIMITED`

#### Scenario: IPv6 addresses in one /64

- **WHEN** requests for one share id come from `2001:db8:1:2::a` and `2001:db8:1:2::b`
- **THEN** they are charged to the same counters

#### Scenario: Unidentified clients share a bucket

- **WHEN** requests carry no trusted forwarding header
- **THEN** they share the `unidentified` counters, which allow 300 requests per share id and 3000
  requests in total per 600-second window

### Requirement: Public gift response protection

Every response of `/g/{shareId}`, including the not-found page, SHALL carry:

- `Cache-Control` containing `private` and `no-store`;
- `X-Robots-Tag: noindex`;
- `Referrer-Policy: no-referrer`;
- the per-request nonce `Content-Security-Policy` of `content-security-policy`.

The page SHALL render per request and never from a prerendered output. The system MUST NOT write
share ids, page URLs, payloads or signed URLs to application logs. The development server's
incoming-request log SHALL ignore paths that start with `/g/` or `/api/public-gifts/`.

#### Scenario: Private headers

- **WHEN** a published gift's page is served by a production build
- **THEN** the response carries `Cache-Control` with `private` and `no-store`,
  `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, and a policy with `'strict-dynamic'`

#### Scenario: Not-found page is protected too

- **WHEN** an unknown share link is opened
- **THEN** the not-found response carries the same four headers
