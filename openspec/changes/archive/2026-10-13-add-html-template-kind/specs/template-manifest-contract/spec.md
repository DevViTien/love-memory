## ADDED Requirements

### Requirement: Configuration paths of html templates

The system SHALL let a manifest with `kind` `html` map its fields into the template's
configuration object. In such a manifest:

- every field except `audio` MUST have a `path`, and an `audio` field MUST NOT have one, because
  the gift page plays the licensed track itself;
- a `path` MUST be a dot path of 1 to 8 segments and at most 200 characters, each segment matching
  `[A-Za-z_][A-Za-z0-9_]*` and none of them `__proto__`, `constructor` or `prototype`;
- no two fields MAY have the same `path`, and no `path` MAY contain another one as a prefix (for
  example `person` and `person.name`);
- `entry` MUST be `index.html`.

A manifest without `kind`, or with `kind` `sdk`, MUST NOT give any field a `path`. The SDK SHALL
expose `templateKindOf(manifest)`, which answers `sdk` for a manifest without `kind`.

#### Scenario: Fields mapped into the configuration

- **WHEN** an `html` manifest declares `start-date` with `path` `startDate`, `person1-name` with
  `path` `person1.name` and an `audio` field without a path
- **THEN** parsing succeeds and keeps each `path`

#### Scenario: Missing, repeated or nested path

- **WHEN** an `html` manifest has a non-audio field without a `path`, two fields with the `path`
  `name`, or fields with the paths `person` and `person.name`
- **THEN** parsing fails

#### Scenario: Unsafe path

- **WHEN** a `path` is `__proto__`, `a.constructor`, `person..name`, `1name` or has 9 segments
- **THEN** parsing fails

#### Scenario: Path on an sdk field or the audio field

- **WHEN** a manifest without `kind` gives a field a `path`, or an `html` manifest gives its
  `audio` field a `path`
- **THEN** parsing fails

#### Scenario: Entry of an html template

- **WHEN** an `html` manifest declares the `entry` `main.html`
- **THEN** parsing fails with `An html template's entry must be index.html.`

## MODIFIED Requirements

### Requirement: Manifest identity, version and status

The system SHALL accept a template manifest only when it is an object with exactly the required keys
`id`, `version`, `engineVersion`, `status`, `entry`, `previewFixture`, `meta`, `fields`,
`capabilities` and `budgets`, plus the optional keys `steps` and `kind`; unknown keys MUST be rejected. `kind` MUST be
`sdk` (a template built in the repository) or `html` (a template imported as data, see
`template-artifact-delivery`); a manifest without `kind` is an `sdk` manifest, so manifests
written before kinds existed stay valid unchanged. `id`
MUST be a lowercase kebab-case identifier of 1 to 80 characters. `version` and `engineVersion` MUST
be valid Semantic Versioning 2.0.0 strings without leading zeroes in numeric identifiers. `status`
MUST be one of `draft`, `published` or `retired`. The SDK SHALL expose the current engine version
as `TEMPLATE_ENGINE_VERSION` = `1.0.0`.

#### Scenario: Valid manifest

- **WHEN** a manifest with `id` `memory-box`, `version` `1.0.0`, `engineVersion` `1.0.0` and
  `status` `published` and otherwise valid content is parsed
- **THEN** parsing succeeds and returns the manifest

#### Scenario: Unversioned or malformed version

- **WHEN** `version` is `latest`, `1.0` or `01.0.0`
- **THEN** parsing fails

#### Scenario: Unknown top-level key

- **WHEN** a manifest contains a key that is not part of the contract
- **THEN** parsing fails

#### Scenario: Optional steps key

- **WHEN** an otherwise valid manifest contains a valid `steps` list
- **THEN** parsing succeeds and the returned manifest keeps `steps`

#### Scenario: Template kind

- **WHEN** an otherwise valid manifest declares `kind` `html`, declares no `kind`, or declares
  `kind` `react`
- **THEN** the first parses as an `html` manifest, the second parses as an `sdk` manifest, and
  the third fails

### Requirement: Field definitions

The system SHALL require `fields` to contain 1 to 40 field definitions with unique `id` values,
each discriminated by `type` and rejecting unknown keys. Every field MUST have an `id` (kebab-case,
1 to 80 characters) and a `label` (1 to 80 characters), MAY have `helpText` (at most 200
characters), has `required` defaulting to `false`, and MAY have a `path` as specified in "Configuration paths of
html templates". The supported field types and their
constraints SHALL be:

- `shortText`: `maxLength` integer from 1 to 200.
- `longText`: `maxLength` integer from 1 to 5000.
- `date`: no additional properties.
- `imageList`: `aspectRatio` as `width:height` with positive integers, `maxItems` integer from 1 to
  30, `minItems` non-negative integer not greater than `maxItems`.
- `captionedImageList`: the same `aspectRatio`, `maxItems` and `minItems` constraints as
  `imageList`, plus `captionMaxLength` integer from 1 to 200.
- `textList`: a list of short texts, with `itemMaxLength` integer from 1 to 500, `maxItems`
  integer from 1 to 50, and `minItems` non-negative integer not greater than `maxItems`.
- `image`: one photo, with an optional `aspectRatio` as `width:height` with positive integers;
  the Studio crops to `1:1` when it is absent.
- `passcode`: a playful lock code inside the template, never access control, with `length`
  integer from 4 to 8.
- `color`: no additional properties.
- `theme`: `options` of 1 to 12 unique kebab-case identifiers.
- `audio`: `source` equal to `licensedLibrary`.

Any other `type` MUST be rejected.

#### Scenario: Duplicate field ids

- **WHEN** two fields share the same `id`
- **THEN** parsing fails with `Template field ids must be unique.`

#### Scenario: Invalid image list constraints

- **WHEN** an `imageList` or `captionedImageList` field has `aspectRatio` `0:0`, or `minItems`
  greater than `maxItems`
- **THEN** parsing fails

#### Scenario: Captioned image list definition

- **WHEN** a `captionedImageList` field has `aspectRatio` `4:5`, `minItems` 3, `maxItems` 8 and
  `captionMaxLength` 140
- **THEN** the field is accepted

#### Scenario: Invalid caption limit

- **WHEN** a `captionedImageList` field has no `captionMaxLength`, or `captionMaxLength` is 0 or 201
- **THEN** parsing fails

#### Scenario: Unsupported field type

- **WHEN** a field has `type` `video`
- **THEN** parsing fails

#### Scenario: New field types

- **WHEN** fields declare `textList` with `itemMaxLength` 80, `minItems` 2 and `maxItems` 5,
  `image` with `aspectRatio` `25:26`, `passcode` with `length` 4, and `color`
- **THEN** the fields are accepted

#### Scenario: Invalid new field definitions

- **WHEN** a `textList` field has `itemMaxLength` 501, `maxItems` 51 or `minItems` greater than
  `maxItems`, an `image` field has `maxItems`, a `passcode` field has `length` 3 or 9, or a
  `color` field has `options`
- **THEN** parsing fails

#### Scenario: Image fields

- **WHEN** a manifest declares `image`, `imageList` and `captionedImageList` fields
- **THEN** all three are image fields; an `image` field holds at most 1 photo and at least 1
  when it is `required`, otherwise 0

### Requirement: Payload validation against fields

The system SHALL validate gift content for a template version with a schema derived from that
manifest's `fields`: an object keyed by field `id` that rejects undeclared keys, requires every
field with `required` `true` and allows other fields to be omitted. Supplied values MUST satisfy:

- `shortText` and `longText`: a string that, after trimming surrounding whitespace, has 1 to
  `maxLength` characters.
- `date`: an ISO calendar date (`YYYY-MM-DD`).
- `imageList`: an array of unique UUID asset references with `minItems` to `maxItems` entries.
- `captionedImageList`: an array of `minItems` to `maxItems` items, each an object with exactly a
  UUID `assetId` and an optional `caption`, with no two items sharing an `assetId`. A supplied
  `caption` is trimmed of surrounding whitespace and MUST then have 1 to `captionMaxLength`
  characters.
- `textList`: an array of `minItems` to `maxItems` strings, each trimmed of surrounding whitespace
  and then 1 to `itemMaxLength` characters.
- `image`: one UUID asset reference.
- `passcode`: a string of exactly `length` ASCII digits.
- `color`: a `#rrggbb` hexadecimal color, stored in lowercase.
- `theme`: one of the field's `options`.
- `audio`: a track id, a lowercase kebab-case identifier of 1 to 80 characters. Whether the id names
  a selectable track is checked by the gift capabilities against `licensed-audio-catalog`, not by
  payload validation.

A draft variant SHALL treat every field as optional while still validating each supplied value and
rejecting undeclared keys. The draft variant SHALL NOT enforce `minItems` for `imageList`,
`captionedImageList` and `textList` values: it accepts 0 to `maxItems` entries, so that a creator's
images and texts can be saved one at a time. Every other rule, including `maxItems`, uniqueness and the caption rules,
applies unchanged. Each validation issue SHALL be reported with a path whose first segment is the
field `id` it concerns, followed by item indexes and keys when the issue concerns a list item.

#### Scenario: Valid complete payload

- **WHEN** a payload supplies every required field with valid values
- **THEN** validation succeeds

#### Scenario: Rejected payload values

- **WHEN** a payload has an undeclared key, a theme not in `options`, fewer images than `minItems`,
  a duplicated asset id, or an image reference that is not a UUID (such as a `data:` URL)
- **THEN** validation fails

#### Scenario: Captioned images normalized

- **WHEN** a `captionedImageList` value is `[{ "assetId": "<uuid-1>", "caption": "  Đà Lạt 2023 🌲 " },
{ "assetId": "<uuid-2>" }]` for a field with `minItems` 2
- **THEN** validation succeeds, the first caption becomes `Đà Lạt 2023 🌲`, and the second item has
  no caption

#### Scenario: Rejected captioned images

- **WHEN** a `captionedImageList` item has an unknown key such as `url`, an empty or whitespace-only
  `caption`, a `caption` longer than `captionMaxLength`, or an `assetId` repeated in another item
- **THEN** validation fails

#### Scenario: Audio track id format

- **WHEN** an `audio` value is `acoustic-morning`
- **THEN** payload validation succeeds
- **AND** the values `Acoustic Morning`, `https://example.com/song.mp3` and an empty string fail

#### Scenario: Incomplete draft

- **WHEN** a draft payload is `{}`
- **THEN** draft validation succeeds
- **AND** a draft payload with a supplied empty `shortText` value still fails

#### Scenario: Draft with fewer images than the minimum

- **WHEN** a draft payload sets a `captionedImageList` field with `minItems` 3 and `maxItems` 8 to
  one valid item, or an `imageList` field with `minItems` 2 to an empty array
- **THEN** draft validation succeeds
- **AND** full payload validation of the same values fails

#### Scenario: Draft still enforces the maximum and uniqueness

- **WHEN** a draft payload sets an `imageList` field with `maxItems` 5 to six UUIDs, or to two
  equal UUIDs
- **THEN** draft validation fails with an issue whose path starts with that field's `id`

#### Scenario: New field values

- **WHEN** a payload sets a `textList` field to `["  Một ", "Hai"]`, an `image` field to a UUID, a
  `passcode` field of `length` 4 to `0420` and a `color` field to `#FFAA00`
- **THEN** validation succeeds, the lines become `Một` and `Hai`, and the color becomes `#ffaa00`

#### Scenario: Rejected new field values

- **WHEN** a `textList` line is blank or longer than `itemMaxLength`, an `image` value is a
  `data:` URL or a list, a `passcode` value has 3 digits, letters or full-width digits, or a
  `color` value is `#fff` or `red`
- **THEN** validation fails in both the draft and the full variant

#### Scenario: Draft with fewer lines than the minimum

- **WHEN** a draft payload sets a `textList` field with `minItems` 2 to one line
- **THEN** draft validation succeeds and full payload validation fails
