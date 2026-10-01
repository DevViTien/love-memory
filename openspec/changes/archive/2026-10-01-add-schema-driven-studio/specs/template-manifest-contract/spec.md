## MODIFIED Requirements

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
rejecting undeclared keys. The draft variant SHALL NOT enforce `minItems` for `imageList` and
`captionedImageList` values: it accepts 0 to `maxItems` entries, so that a creator's images can be
saved one at a time. Every other rule, including `maxItems`, uniqueness and the caption rules,
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

### Requirement: Studio steps

The system SHALL accept an optional top-level `steps` list that groups the manifest's fields into
ordered Studio steps. When present, `steps` MUST contain 1 to 8 entries, each an object with exactly
`id` (kebab-case, 1 to 80 characters, unique among steps), `label` (1 to 40 characters) and
`fieldIds` (1 to 40 field ids). A step `id` MUST NOT be `preview` or `publish`, which the Studio
reserves for its own steps. Every id in `fieldIds` MUST name a field declared in `fields`, and
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

#### Scenario: Reserved step id

- **WHEN** a manifest declares a step with `id` `preview` or `publish`
- **THEN** parsing fails
