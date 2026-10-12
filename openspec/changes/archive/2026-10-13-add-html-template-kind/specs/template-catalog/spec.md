## MODIFIED Requirements

### Requirement: Template summary is derived from the stored manifest

The system SHALL build each catalog entry from the stored manifest of the selected version, after
re-validating it against the template manifest schema. A summary MUST expose only `id`, `version`,
`name`, `description`, `estimatedDurationSec`, `moods`, `available`, and, when the manifest
declares an image field (`imageList`, `captionedImageList` or `image`), an `imageRequirement` whose
`minItems` and `maxItems` add up the ranges of every image field: a list field's `minItems` and
`maxItems`, and for an `image` field `1` and `1` when it is required, `0` and `1` otherwise. `available` SHALL be `true` only when a
template artifact is registered for that exact `id` and `version` (`template-artifact-delivery`),
either as an `sdk` release or as an imported `html` version, so
a gift created from it can be previewed with the template and published; otherwise it is `false`.
Stored manifests that fail validation MUST NOT be rendered as catalog entries. Such a version
SHALL be left out of the catalog and of the template detail, and reported to the operational log by
its `<templateId>@<version>` only, without failing the other entries (for example an `html` version
read by a build that predates the kind).

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
- **THEN** that entry is left out, the other entries are listed, and the log names only its
  `<templateId>@<version>`

#### Scenario: Template with single photo fields

- **WHEN** the current version is `love-days` `1.0.0`, with two optional `image` fields and one
  required `image` field
- **THEN** its summary includes `imageRequirement` `{ minItems: 1, maxItems: 3 }`, and its card
  shows `1–3 ảnh`

#### Scenario: Imported html version

- **WHEN** the current version is `love-days` `1.0.0`, imported by `db:seed`
- **THEN** its summary has `available` `true`, and `/studio/new?template=love-days` offers to
  create a draft

### Requirement: Seeded launch templates

The system SHALL provide a seed command (`db:seed`) that idempotently upserts three published
templates in this `sortOrder`:

- `memory-box` (`Hộp ký ức`) at current version `1.1.0`;
- `our-timeline` (`Dòng thời gian hai đứa`) at version `1.0.0`;
- `midnight-wish` (`Bầu trời lời nhắn`) at version `1.0.0`.

The `memory-box` `1.1.0` manifest and preview fixture MUST be the ones of the committed release
`templates/memory-box/releases/1.1.0/`. The seed SHALL also keep the earlier release `memory-box` `1.0.0`, with its
original manifest and preview fixture, as a version with status `retired`. After them, the seed
SHALL import every bundled `html` template folder under `templates-html/`, in folder name order
and published (`template-artifact-delivery` "HTML template import command"), today `love-days`
(`Trái tim yêu thương`) at version `1.0.0`.

Seeding MUST:

- set each template's `currentVersion` and status from its current version's manifest;
- store every version under the identity `{templateId}@{version}` together with its manifest and
  preview fixture;
- abort if a template has no preview fixture, or its preview fixture fails payload validation
  against the manifest;
- abort, without changing that version, when a version is already stored with a manifest whose
  content differs, ignoring key order, because a template release is immutable;
- leave the status of a version that an admin retired or killed (`template-version-controls`)
  unchanged, so a re-run never brings it back into the catalog or new drafts.

#### Scenario: Seed on an empty database

- **WHEN** `db:seed` runs against an empty database
- **THEN** the catalog lists `memory-box` at version `1.1.0`, then `our-timeline` and
  `midnight-wish` each at version `1.0.0`, then `love-days` at version `1.0.0`, in that order
- **AND** `memory-box` `1.0.0` is stored with status `retired`

#### Scenario: Upgrading a database seeded with 1.0.0

- **WHEN** `db:seed` runs against a database where `memory-box` `1.0.0` is the published current
  version and drafts pin it
- **THEN** `memory-box` `1.0.0` keeps its stored manifest and becomes `retired`, `currentVersion`
  becomes `1.1.0`, and those drafts stay editable against the `1.0.0` manifest
- **AND** new drafts can be created only on `memory-box` `1.1.0`

#### Scenario: Re-running the seed

- **WHEN** `db:seed` runs again against an already seeded database
- **THEN** the existing records are updated in place and no duplicate templates or versions are
  created

#### Scenario: Invalid preview fixture

- **WHEN** a seed manifest's preview fixture does not satisfy that manifest's payload rules
- **THEN** seeding fails before writing that template

#### Scenario: Stored release differs from the seed

- **WHEN** `memory-box@1.1.0` is already stored with a manifest whose content differs from the
  committed release manifest
- **THEN** seeding fails naming `memory-box@1.1.0` and leaves the stored version unchanged

#### Scenario: Re-seeding keeps an admin retire

- **WHEN** an admin retired `our-timeline` `1.0.0` and `db:seed` runs again
- **THEN** `our-timeline` `1.0.0` stays `retired`, and every other seeded version gets its seeded
  status

#### Scenario: Bundled html template seeded

- **WHEN** `db:seed` runs twice against an empty database with object storage configured
- **THEN** `love-days@1.0.0` is stored once with `kind` `html`, its files are in object storage,
  and the second run reports it `unchanged`
