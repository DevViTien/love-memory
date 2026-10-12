## MODIFIED Requirements

### Requirement: Asset URL selection

The `assets` map SHALL contain an entry for an asset id when all of these hold:

- the asset id is referenced by an image field (`imageList`, `captionedImageList` or `image`) of
  the payload;
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

#### Scenario: Single photo field

- **WHEN** a `love-days` gift's `photo` field references a `ready` asset uploaded for `photo`
- **THEN** `assets` maps that id to a signed URL, and `payload.photo` keeps the asset id

### Requirement: Field summaries

The `fields` list SHALL describe every manifest field in declaration order. Each entry has only:

- `id`;
- `label`;
- `type`;
- `required`;
- `minItems` and `maxItems`, for list fields (`imageList`, `captionedImageList` and `textList`)
  and `image` fields only; an `image` field has `maxItems` `1` and `minItems` `1` when it is
  required, `0` otherwise.

These are enough for a host to render the content statically and to label issues. `fields` MUST
NOT contain gift content.

#### Scenario: Memory Box fields

- **WHEN** the transformation runs for `memory-box` `1.1.0`
- **THEN** `fields` lists `receiver-name`, `anniversary-date`, `opening-message`, `memories`,
  `final-letter`, `theme` and `audio` in that order, and `memories` has `minItems` `3` and
  `maxItems` `8`

#### Scenario: Html template fields

- **WHEN** the transformation runs for a manifest with a `textList` field (`minItems` 2, `maxItems`
  4), a required `image` field, a `passcode` field and a `color` field
- **THEN** the `textList` entry has `minItems` `2` and `maxItems` `4`, the `image` entry has
  `minItems` `1` and `maxItems` `1`, and the `passcode` and `color` entries have neither

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
  `assets`; the photo of an `image` field is item `0`.

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

#### Scenario: Html template content issues

- **WHEN** a `textList` field with `minItems` 2 holds one line, a `passcode` field of `length` 4
  holds `12`, and an optional `image` field references an asset that is not `ready`
- **THEN** `issues` contains `CONTENT_TOO_FEW` for the `textList` field, `CONTENT_INVALID` for the
  `passcode` field, and `ASSET_UNAVAILABLE` for the `image` field with `itemIndex` `0`
