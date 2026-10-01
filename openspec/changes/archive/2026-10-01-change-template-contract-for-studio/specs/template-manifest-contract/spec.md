# Spec Delta

## ADDED Requirements

### Requirement: Studio steps

The system SHALL accept an optional top-level `steps` list that groups the manifest's fields into
ordered Studio steps. When present, `steps` MUST contain 1 to 8 entries, each an object with exactly
`id` (kebab-case, 1 to 80 characters, unique among steps), `label` (1 to 40 characters) and
`fieldIds` (1 to 40 field ids). Every id in `fieldIds` MUST name a field declared in `fields`, and
every declared field MUST appear in exactly one step. Unknown step keys MUST be rejected. The
order of `steps`, and the order of `fieldIds` inside a step, SHALL be the order in which the
Studio presents them. When `steps` is absent, the SDK SHALL resolve the manifest to a single
step with `id` `content`, `label` `Nội dung` and every field id in declaration order.

#### Scenario: Fields grouped into steps

- **WHEN** a manifest declares fields `receiver-name`, `memories` and `final-letter`, and `steps`
  `[{ id: "recipient", label: "Người nhận", fieldIds: ["receiver-name"] }, { id: "story", label:
"Câu chuyện", fieldIds: ["memories", "final-letter"] }]`
- **THEN** parsing succeeds and the resolved steps are `recipient` followed by `story`, with
  `memories` before `final-letter`

#### Scenario: Manifest without steps

- **WHEN** a manifest with fields `headline`, `photos` and `final-message` has no `steps` key
- **THEN** the resolved steps are one step `content` labelled `Nội dung` containing `headline`,
  `photos` and `final-message` in that order

#### Scenario: Unassigned, duplicated or unknown field id

- **WHEN** `steps` omits a declared field, lists the same field id in two steps, or lists a field
  id that `fields` does not declare
- **THEN** parsing fails

#### Scenario: Duplicate step id or too many steps

- **WHEN** two steps share an `id`, or `steps` has 9 entries
- **THEN** parsing fails

## MODIFIED Requirements

### Requirement: Manifest identity, version and status

The system SHALL accept a template manifest only when it is an object with exactly the required keys
`id`, `version`, `engineVersion`, `status`, `entry`, `previewFixture`, `meta`, `fields`,
`capabilities` and `budgets`, plus the optional key `steps`; unknown keys MUST be rejected. `id`
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

### Requirement: Field definitions

The system SHALL require `fields` to contain 1 to 40 field definitions with unique `id` values,
each discriminated by `type` and rejecting unknown keys. Every field MUST have an `id` (kebab-case,
1 to 80 characters) and a `label` (1 to 80 characters), MAY have `helpText` (at most 200
characters), and has `required` defaulting to `false`. The supported field types and their
constraints SHALL be:

- `shortText`: `maxLength` integer from 1 to 200.
- `longText`: `maxLength` integer from 1 to 5000.
- `date`: no additional properties.
- `imageList`: `aspectRatio` as `width:height` with positive integers, `maxItems` integer from 1 to
  30, `minItems` non-negative integer not greater than `maxItems`.
- `captionedImageList`: the same `aspectRatio`, `maxItems` and `minItems` constraints as
  `imageList`, plus `captionMaxLength` integer from 1 to 200.
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
- `theme`: one of the field's `options`.
- `audio`: a track id, a lowercase kebab-case identifier of 1 to 80 characters. Whether the id names
  a selectable track is checked by the gift capabilities against `licensed-audio-catalog`, not by
  payload validation.

A draft variant SHALL treat every field as optional while still validating each supplied value and
rejecting undeclared keys.

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

### Requirement: CI gate for every template workspace

The system SHALL, in the test suite run by CI, discover every directory under `templates/` and fail
unless each one provides `template.manifest.json`, `dist/build-metrics.json`, `dist/artifact.json`
and `dist/manifest.json`. For each template the gate MUST verify that the manifest is valid, its
`id` equals the directory name, its `entry` and `previewFixture` files exist in `dist/`, the preview
fixture passes full payload validation, every `audio` value in the preview fixture names a track in
the licensed audio catalog, the measured metrics are within budget, `artifact.json` has a
64-character lowercase hexadecimal `contentHash` and the manifest's `id` and `version`, and
`dist/manifest.json` equals the source manifest. Templates SHALL be built before this gate runs.

#### Scenario: Conforming template

- **WHEN** `templates/memory-box-spike` is built and its artifacts satisfy every check
- **THEN** the gate passes

#### Scenario: Over-budget or invalid template

- **WHEN** a template's measured `initialJsKbGzip` exceeds its manifest budget, its preview fixture
  fails validation, or its manifest `id` differs from its directory name
- **THEN** the CI test run fails

#### Scenario: Fixture references an unknown track

- **WHEN** a template's preview fixture sets its `audio` field to an id that is not in the licensed
  audio catalog
- **THEN** the CI test run fails naming the template and the unknown track id

#### Scenario: Missing build output

- **WHEN** a template directory lacks `dist/build-metrics.json` or `dist/artifact.json`
- **THEN** the CI test run fails naming the missing file
