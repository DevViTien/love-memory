# privacy-notice Specification

## Purpose

Tells creators and recipients, before they rely on LoveMemory, what is stored, who can see it, how
long it is kept and how to remove or export it, and records the creator's confirmation that they may
share what they publish.

## Requirements

### Requirement: Privacy notice page

The system SHALL serve `/privacy` as a static public page titled `Chính sách quyền riêng tư`. It
SHALL state, in Vietnamese:

- **What is stored:** the account email; gift drafts and published gifts (text, dates, the chosen
  music and photos); reports; operational logs without gift content.
- **Who can see a gift:** the creator, anyone with the share link while the gift is published, and
  the operations team only to review a report.
- **The retention table:**
  - drafts are kept until the owner deletes them;
  - a published gift opens for the plan's period (14 days on Free, 1 year on Standard) and is then
    kept for the owner until deleted;
  - the version shown before an update is deleted within minutes of the update;
  - original photos are not kept; only processed photos without location data are;
  - a deleted gift's link stops at once, and its content and photos are erased within 24 hours,
    keeping a record of ids and times for 1 year;
  - reports and the admin audit log are kept 1 year;
  - sign-in sessions last 30 days;
  - anonymous statistics, when enabled, are kept 180 days without any account link.
- **Cookies and storage:** the session cookie, the anonymous draft cookie (30 days), and no
  advertising or third-party tracking.
- **The owner's controls:** pause, delete and export from the Studio, and the report form on a
  gift.

The page SHALL use the static-compatible CSP of public routes (`content-security-policy`).

#### Scenario: Notice reachable without an account

- **WHEN** a signed-out browser opens `/privacy`
- **THEN** the page shows `Chính sách quyền riêng tư`, the retention table, and the cookie section

### Requirement: Privacy links

Every page SHALL show a site footer with a link `Quyền riêng tư` to `/privacy`. The sign-in form
SHALL show, below its submit button,
`Khi tiếp tục, bạn đồng ý để LoveMemory xử lý dữ liệu như mô tả trong Chính sách quyền riêng tư.`,
where `Chính sách quyền riêng tư` links to `/privacy`.

#### Scenario: Footer on the recipient page

- **WHEN** a recipient opens `/g/{shareId}`
- **THEN** the footer link `Quyền riêng tư` leads to `/privacy`

### Requirement: Upload-rights confirmation

A publish or an update SHALL require the creator to confirm, in the Studio, the statement
`Tôi có quyền dùng các ảnh và nội dung trong món quà này, và người xuất hiện trong ảnh đồng ý chia sẻ.`
(`studio-editor` "Studio preview and publish steps"). The publish endpoint SHALL refuse a request
without `rightsConfirmed: true` (`gift-publishing` "Publish endpoint and authorization"). Each
publication record SHALL hold `rightsConfirmedAt`, its publication time.

#### Scenario: Publish without the confirmation refused

- **WHEN** a publish request omits `rightsConfirmed`
- **THEN** the response is `400` with `error.fieldErrors.rightsConfirmed`, and nothing is published

### Requirement: Owner export

`GET /api/gifts/{publicId}/export` SHALL answer the gift's owner with a JSON attachment named
`love-memory-{publicId}.json`, `Cache-Control: no-store`.

**Who.** It uses the access rules of `gift-draft-ownership`: any draft accessor for a `draft`, and
only the signed-in owner for a `published` or `paused` gift. Every other request, and every other
status, SHALL answer `404` with code `NOT_FOUND`.

**The document** holds exactly:

- `exportedAt`;
- `gift`: `publicId`, `status`, `templateId`, `templateVersion`, `revision`, `createdAt`,
  `updatedAt`;
- `content`: the working copy's stored content;
- `publication`: `publishedAt`, `revision`, `planId`, `expiresAt` and `sharePath`, or `null` for a
  draft;
- `photos`: one entry per `ready` photo of the gift, with:
  - `assetId` and `fieldId`;
  - `width` and `height`;
  - `url`, a signed download URL of its largest derivative, valid for 300 seconds.

It MUST NOT hold storage keys, the anonymous draft credentials, other users' data or report
details.

#### Scenario: Owner exports a published gift

- **WHEN** the owner opens `Tải dữ liệu món quà` in the Studio of a published gift
- **THEN** the browser downloads `love-memory-{publicId}.json` holding the content, the publication
  summary and signed photo URLs, and no storage key

#### Scenario: Someone else asks for the export

- **WHEN** a browser without the owner's session requests the export of a published gift
- **THEN** the response is `404` with code `NOT_FOUND`
