# Spec Delta

## Purpose

Defines the single server-side transformation from a gift's template version, stored content,
asset records and the licensed audio catalog into the input of a gift viewer. It covers the
artifact URL and its optional pin, the payload, the signed asset URLs and their expiry, the audio
URL, the field summaries and the content issues. Preview uses it, and the published Viewer MUST use
the same transformation so that what a creator previews is what a recipient sees.

## ADDED Requirements

### Requirement: One transformation for every gift viewer

The system SHALL build the input of every gift viewer that shows stored gift content with one
server-side transformation. This includes the preview page (`gift-preview`) and any later published
Viewer. The transformation takes:

- the bound template manifest;
- the stored content;
- the gift's asset records;
- the audio catalog;
- optionally, an expected artifact `contentHash`.

It SHALL return exactly:

- `artifactUrl`;
- `payload`;
- `assets`;
- `assetsExpireAt`;
- `audioUrl`;
- `fields`;
- `issues`.

`issues` is creator feedback. A caller that serves a recipient MAY omit it from its response, and a
gift viewer MUST work without it. The transformation MUST run only after the caller has authorized
access to the gift. It MUST NOT return storage keys, pathnames, owner identifiers, checksums, asset
documents or anything else not listed here. It MUST NOT log the content, the asset URLs or the
audio URL.

#### Scenario: Same input, same output shape

- **WHEN** the transformation runs for the same manifest, content, asset records and catalog
- **THEN** it returns the same `artifactUrl`, `payload`, `fields`, `issues`, `audioUrl` and the
  same set of `assets` keys. Only the signatures and expiry times inside asset URLs, and
  `assetsExpireAt`, may differ

#### Scenario: No storage details leak

- **WHEN** the transformation output for a gift with `ready` assets is serialized
- **THEN** it contains no object key such as `private/assets/`, no owner id and no checksum

#### Scenario: Recipient response without issues

- **WHEN** a caller omits `issues` from the output it sends to a browser
- **THEN** a gift viewer given that output plays the gift normally

### Requirement: Artifact resolution

The `artifactUrl` SHALL be the content-addressed entry URL
`/template-artifacts/{templateId}/{version}/{contentHash}/index.html` of the exact template version
that the gift is bound to, when that exact version has a registered artifact. `artifactUrl` SHALL be
`null` in two cases:

- the version has no registered artifact, such as the retired `memory-box` `1.0.0`;
- an expected `contentHash` was supplied and differs from the registered one.

The rest of the output SHALL still be built, so the gift viewer shows the static rendering. The
transformation MUST NOT fall back to another version of the template, or to an artifact whose
`contentHash` differs from the expected one.

#### Scenario: Current Memory Box draft

- **WHEN** the gift is bound to `memory-box` `1.1.0` and no expected `contentHash` is supplied
- **THEN** `artifactUrl` is `/template-artifacts/memory-box/1.1.0/{contentHash}/index.html` with the
  registered 64-character `contentHash`

#### Scenario: Version without an artifact

- **WHEN** the gift is bound to `memory-box` `1.0.0`
- **THEN** `artifactUrl` is `null`, and `payload`, `assets`, `fields` and `issues` are still returned
- **AND** no artifact of `memory-box` `1.1.0` is used instead

#### Scenario: Pinned artifact matches

- **WHEN** the expected `contentHash` equals the registered `contentHash` of `memory-box` `1.1.0`
- **THEN** `artifactUrl` points to that artifact

#### Scenario: Pinned artifact differs

- **WHEN** the expected `contentHash` differs from the registered one
- **THEN** `artifactUrl` is `null` and the rest of the output is still returned

### Requirement: Payload is the stored content

The `payload` SHALL be the gift's stored content data, unchanged: the same keys, values and order
of list items. Image fields keep their asset ids, and captions stay next to their asset ids. The
transformation MUST NOT insert URLs, remove values or fill in defaults.

#### Scenario: Captioned images unchanged

- **WHEN** the stored `memories` value is `[{ "assetId": "<a>", "caption": "Đà Lạt 2023 🌲" }, { "assetId": "<b>" }]`
- **THEN** `payload.memories` is exactly that list

#### Scenario: Incomplete draft

- **WHEN** the stored content is `{}`
- **THEN** `payload` is `{}`

### Requirement: Asset URL selection

The `assets` map SHALL contain an entry for an asset id when all of these hold:

- the asset id is referenced by an `imageList` or `captionedImageList` field of the payload;
- the asset belongs to the same gift;
- the asset was uploaded for that same field;
- the asset's status is `ready`.

The entry's value SHALL be a signed private download URL of one derivative of that asset. It uses
the derivative with the smallest width of at least 768 pixels, or the widest derivative when none
reaches 768 pixels. The URL SHALL be valid for 300 seconds, like every other asset download URL.
`assetsExpireAt` SHALL be the ISO 8601 time at which the earliest URL in `assets` expires, or `null`
when `assets` is empty.

Every other referenced asset id MUST be left out of `assets`: an asset that is missing, `deleted`,
not `ready`, of another gift or of another field. The payload MUST still keep that id, so the
template shows its text card.

#### Scenario: Ready asset signed at 768 pixels

- **WHEN** a `ready` asset referenced by `memories` has derivatives 320, 768 and 1280 pixels wide
- **THEN** `assets` maps its id to a signed URL of the 768-pixel derivative that expires 300
  seconds after issuance, and `assetsExpireAt` is no later than that expiry

#### Scenario: Small source image

- **WHEN** a `ready` asset's derivatives are 320 and 600 pixels wide
- **THEN** `assets` maps its id to a signed URL of the 600-pixel derivative

#### Scenario: Asset still processing

- **WHEN** the second item of `memories` references an asset in status `processing`
- **THEN** `assets` has no entry for that id, and `payload.memories[1].assetId` is unchanged

#### Scenario: Asset of another field or gift

- **WHEN** the payload references an asset id that belongs to another gift, or to another image
  field of the same gift
- **THEN** `assets` has no entry for that id and no URL is signed for it

#### Scenario: No images

- **WHEN** the payload references no asset
- **THEN** `assets` is `{}` and `assetsExpireAt` is `null`

### Requirement: Audio URL resolution

The `audioUrl` SHALL be the catalog URL (`/audio-library/{fileName}`) of the track named by the
value of the manifest's first `audio` field, when that track is selectable (`active`). It SHALL be
`null` in these cases:

- the manifest has no `audio` field;
- the value is absent;
- the track is unknown or `withdrawn`.

#### Scenario: Selected active track

- **WHEN** the payload's `audio` value is the `active` track `acoustic-morning`
- **THEN** `audioUrl` is that track's `/audio-library/` URL

#### Scenario: No music

- **WHEN** the payload has no `audio` value, or the catalog is empty
- **THEN** `audioUrl` is `null`

#### Scenario: Withdrawn track

- **WHEN** the payload's `audio` value names a `withdrawn` track
- **THEN** `audioUrl` is `null` and `issues` contains `CONTENT_INVALID` for the `audio` field

### Requirement: Field summaries

The `fields` list SHALL describe every manifest field in declaration order. Each entry has only:

- `id`;
- `label`;
- `type`;
- `required`;
- `minItems` and `maxItems`, for image fields only.

These are enough for a host to render the content statically and to label issues. `fields` MUST
NOT contain gift content.

#### Scenario: Memory Box fields

- **WHEN** the transformation runs for `memory-box` `1.1.0`
- **THEN** `fields` lists `receiver-name`, `anniversary-date`, `opening-message`, `memories`,
  `final-letter`, `theme` and `audio` in that order, and `memories` has `minItems` `3` and
  `maxItems` `8`

### Requirement: Content issues

The `issues` list SHALL report what a recipient could not see or what publishing would reject.
Each issue has `code`, `fieldId` and, for a problem with one item of a list field, `itemIndex`
(zero-based). Issues MUST NOT carry gift text. The issues SHALL be:

- `CONTENT_MISSING` for each `required` field whose value is absent;
- `CONTENT_TOO_FEW` for each list field whose value has fewer items than its `minItems`;
- `CONTENT_INVALID` for any other failure of the full (non-draft) payload rules of
  `template-manifest-contract`. When the failure concerns one list item, the issue carries that
  item's `itemIndex`, taken from the second segment of the failing path. It is also used for an
  `audio` value that is not a selectable track;
- `ASSET_UNAVAILABLE`, with `itemIndex`, for each image item whose asset id has no entry in
  `assets`.

Each (`code`, `fieldId`, `itemIndex`) SHALL appear at most once. Issues SHALL be ordered by field
declaration order, then by `itemIndex`. Content that passes full validation, with every referenced
asset available, SHALL produce an empty list.

#### Scenario: Empty Memory Box draft

- **WHEN** the transformation runs for a `memory-box` `1.1.0` gift whose content is `{}`
- **THEN** `issues` is `CONTENT_MISSING` for `receiver-name`, `opening-message`, `memories` and
  `final-letter`, in that order

#### Scenario: Too few photos, one still processing

- **WHEN** `memories` holds 2 items and the asset of the second item is `processing`
- **THEN** `issues` contains `CONTENT_TOO_FEW` for `memories` and `ASSET_UNAVAILABLE` for
  `memories` with `itemIndex` `1`

#### Scenario: Invalid item

- **WHEN** the third item of `memories` has a caption longer than `captionMaxLength`
- **THEN** `issues` contains `CONTENT_INVALID` for `memories` with `itemIndex` `2`

#### Scenario: Complete gift

- **WHEN** the content passes full payload validation and every referenced asset is `ready`
- **THEN** `issues` is empty
