## MODIFIED Requirements

### Requirement: Template summary is derived from the stored manifest

The system SHALL build each catalog entry from the stored manifest of the selected version, after
re-validating it against the template manifest schema. A summary MUST expose only `id`, `version`,
`name`, `description`, `estimatedDurationSec`, `moods`, `available`, and, when the manifest
declares an `imageList` or `captionedImageList` field, an `imageRequirement` with the first such
field's `minItems` and `maxItems` in declaration order. `available` SHALL be `true` only when a
template artifact is registered for that exact `id` and `version` (`template-artifact-delivery`), so
a gift created from it can be previewed with the template and published; otherwise it is `false`.
Stored manifests that fail validation MUST NOT be rendered as catalog entries.

#### Scenario: Template with an image field

- **WHEN** the current version of `memory-box` declares an `imageList` field with `minItems` 3 and
  `maxItems` 8
- **THEN** its summary includes `imageRequirement` `{ minItems: 3, maxItems: 8 }`

#### Scenario: Template with a captioned image field

- **WHEN** the current version declares a `captionedImageList` field with `minItems` 3 and
  `maxItems` 8 and no `imageList` field
- **THEN** its summary includes `imageRequirement` `{ minItems: 3, maxItems: 8 }`

#### Scenario: Template without an image field

- **WHEN** the current version declares no `imageList` or `captionedImageList` field
- **THEN** its summary has no `imageRequirement`

#### Scenario: Version with a registered artifact

- **WHEN** the current version is `memory-box` `1.1.0`, whose artifact is registered
- **THEN** its summary has `available` `true`

#### Scenario: Version without a registered artifact

- **WHEN** the current version is `our-timeline` `1.0.0`, for which no artifact is registered
- **THEN** its summary has `available` `false`, and it is still listed in the catalog

#### Scenario: Invalid stored manifest

- **WHEN** the stored manifest of a selected version fails schema validation
- **THEN** the request fails and the route error state is shown instead of a partial entry

### Requirement: Template detail page

The system SHALL serve a detail page at `/templates/{templateId}` for a template that satisfies the
same published-current-version rule as the catalog list. The page MUST show the template name,
description, localized mood label, duration label and photo requirement, and link back to
`/templates`. When the summary is `available`, the page SHALL offer a call to action linking to
`/studio/new?template={templateId}`. When it is not, the page MUST NOT offer that link and SHALL show
`Sắp ra mắt` with the explanation `Mẫu quà này đang được hoàn thiện, bạn chưa thể tạo quà từ mẫu này.`
The page title and description metadata SHALL be the template's `name` and `description`.

#### Scenario: Published template detail

- **WHEN** a visitor opens `/templates/memory-box` and `memory-box` has a published current version
- **THEN** the page shows that version's metadata and a link to `/studio/new?template=memory-box`

#### Scenario: Template that is not yet available

- **WHEN** a visitor opens `/templates/our-timeline` and its current version has no registered
  artifact
- **THEN** the page shows its metadata, `Sắp ra mắt` and the explanation, and no link to
  `/studio/new?template=our-timeline`

#### Scenario: Unknown or unpublished template

- **WHEN** a visitor opens `/templates/{templateId}` for a template that does not exist, is not
  `published`, or whose current version is not `published`
- **THEN** the application not-found page is rendered instead of template details
- **AND** the page metadata title is `Không tìm thấy template`

### Requirement: Card presentation rules

The system SHALL present every catalog entry as a card whose labels are derived deterministically
from the summary: the duration label is `Khoảng {estimatedDurationSec} giây`; the mood label joins
the Vietnamese label of each mood with `·` (`warm` → `Ấm áp`, `playful` → `Bất ngờ`,
`nostalgic` → `Hoài niệm`, `dreamy` → `Mơ màng`, `romantic` → `Lãng mạn`) and shows unknown mood
identifiers verbatim; the photo requirement is `{minItems}–{maxItems} ảnh` when an
`imageRequirement` exists and `Không bắt buộc` otherwise. A card whose summary is not `available`
SHALL also show the badge `Sắp ra mắt`. Each card MUST link to `/templates/{id}`. Templates without a
dedicated visual SHALL use a neutral fallback visual (icon `💝`) rather than failing.

#### Scenario: Known template card

- **WHEN** a card is built for `memory-box` with `estimatedDurationSec` 75, moods `warm` and
  `playful`, and an image requirement of 3 to 8
- **THEN** it shows `Khoảng 75 giây`, `Ấm áp · Bất ngờ` and `3–8 ảnh` with icon `🎁`

#### Scenario: Newly introduced template

- **WHEN** a card is built for an unmapped template id with mood `new-mood` and no image requirement
- **THEN** it shows the mood label `new-mood`, the photo requirement `Không bắt buộc` and icon `💝`

#### Scenario: Card of a template that is not yet available

- **WHEN** a card is built for `midnight-wish` whose summary has `available` `false`
- **THEN** it shows the badge `Sắp ra mắt` and still links to `/templates/midnight-wish`
