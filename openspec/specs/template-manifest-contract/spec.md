# Template Manifest Contract

## Purpose

The template manifest is the versioned, machine-validated description of one template release:
its identity, engine version, lifecycle status, catalog metadata, editable fields, declared
capabilities and performance budgets. The same manifest drives payload validation for gift content
and the CI gate that keeps every built template within its budget. How artifacts are delivered is
specified by `template-artifact-delivery`; how the catalog uses manifests is specified by
`template-catalog`.

## Requirements

### Requirement: Manifest identity, version and status

The system SHALL accept a template manifest only when it is an object with exactly the keys `id`,
`version`, `engineVersion`, `status`, `entry`, `previewFixture`, `meta`, `fields`, `capabilities`
and `budgets`; unknown keys MUST be rejected. `id` MUST be a lowercase kebab-case identifier of 1 to
80 characters. `version` and `engineVersion` MUST be valid Semantic Versioning 2.0.0 strings
without leading zeroes in numeric identifiers. `status` MUST be one of `draft`, `published` or
`retired`. The SDK SHALL expose the current engine version as `TEMPLATE_ENGINE_VERSION` = `1.0.0`.

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

### Requirement: Safe artifact paths

The system SHALL require `entry` and `previewFixture` to be safe relative artifact paths of 1 to
200 characters. A path MUST be rejected when it starts with `/`, contains `\`, `:`, `?` or `#`, or
contains an empty, `.` or `..` segment.

#### Scenario: Relative path

- **WHEN** `entry` is `index.js` and `previewFixture` is `fixtures/demo.json`
- **THEN** the paths are accepted

#### Scenario: Unsafe path

- **WHEN** `entry` is `../index.js`, `/index.js`, `https://example.com/index.js` or
  `folder\index.js`
- **THEN** parsing fails

### Requirement: Catalog metadata

The system SHALL require `meta` to contain exactly `name` (1 to 80 characters), `description` (1 to
240 characters), `estimatedDurationSec` (integer from 1 to 600), `moods` (1 to 8 unique
kebab-case identifiers) and `occasions` (1 to 12 unique kebab-case identifiers). Unknown `meta` keys
MUST be rejected.

#### Scenario: Valid metadata

- **WHEN** `meta` has a name, a description, `estimatedDurationSec` 75, moods `warm` and `playful`
  and occasions `anniversary` and `birthday`
- **THEN** the metadata is accepted

#### Scenario: Duplicate or excessive values

- **WHEN** `moods` contains the same identifier twice or `estimatedDurationSec` is 601
- **THEN** parsing fails

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
- `theme`: `options` of 1 to 12 unique kebab-case identifiers.
- `audio`: `source` equal to `licensedLibrary`.

Any other `type` MUST be rejected.

#### Scenario: Duplicate field ids

- **WHEN** two fields share the same `id`
- **THEN** parsing fails with `Template field ids must be unique.`

#### Scenario: Invalid image list constraints

- **WHEN** an `imageList` field has `aspectRatio` `0:0`, or `minItems` greater than `maxItems`
- **THEN** parsing fails

#### Scenario: Unsupported field type

- **WHEN** a field has `type` `video`
- **THEN** parsing fails

### Requirement: Capabilities and budgets

The system SHALL require `capabilities` to be a list of at most 5 unique values from `audio`,
`canvas2d`, `dom`, `svg` and `webgl`. It SHALL require `budgets` to contain exactly
`initialJsKbGzip` (integer from 1 to 1000), `initialMediaKb` (integer from 0 to 10000) and
`maxTextureMb` (integer from 1 to 256).

#### Scenario: Duplicate capability

- **WHEN** `capabilities` is `["dom", "dom"]`
- **THEN** parsing fails

#### Scenario: Budget outside limits

- **WHEN** `budgets.initialJsKbGzip` is 0 or `budgets.maxTextureMb` is 257
- **THEN** parsing fails

### Requirement: Payload validation against fields

The system SHALL validate gift content for a template version with a schema derived from that
manifest's `fields`: an object keyed by field `id` that rejects undeclared keys, requires every
field with `required` `true` and allows other fields to be omitted. Supplied values MUST satisfy:

- `shortText` and `longText`: a string that, after trimming surrounding whitespace, has 1 to
  `maxLength` characters.
- `date`: an ISO calendar date (`YYYY-MM-DD`).
- `imageList`: an array of unique UUID asset references with `minItems` to `maxItems` entries.
- `theme`: one of the field's `options`.
- `audio`: a string of 1 to 160 characters.

A draft variant SHALL treat every field as optional while still validating each supplied value and
rejecting undeclared keys.

#### Scenario: Valid complete payload

- **WHEN** a payload supplies every required field with valid values
- **THEN** validation succeeds

#### Scenario: Rejected payload values

- **WHEN** a payload has an undeclared key, a theme not in `options`, fewer images than `minItems`,
  a duplicated asset id, or an image reference that is not a UUID (such as a `data:` URL)
- **THEN** validation fails

#### Scenario: Incomplete draft

- **WHEN** a draft payload is `{}`
- **THEN** draft validation succeeds
- **AND** a draft payload with a supplied empty `shortText` value still fails

### Requirement: Build budget enforcement

The system SHALL compare measured build metrics against the manifest `budgets`. Measured metrics
MUST be an object with exactly `initialJsKbGzip`, `initialMediaKb` and `maxTextureMb` as
non-negative numbers. A metric SHALL violate its budget only when the measured value is strictly
greater than the declared limit, and every violating metric MUST be reported, not only the first.
An over-budget build MUST fail with an error listing each violation as `{metric}: {actual} > {limit}`.

#### Scenario: Build within budget

- **WHEN** metrics are at or below every declared limit
- **THEN** the check passes and returns the metrics

#### Scenario: Several metrics over budget

- **WHEN** `initialJsKbGzip` 120 exceeds a limit of 100 and `maxTextureMb` 40 exceeds a limit of 32
- **THEN** both violations are reported with their actual value and limit
- **AND** asserting the build fails with a message containing `initialJsKbGzip: 120 > 100`

### Requirement: CI gate for every template workspace

The system SHALL, in the test suite run by CI, discover every directory under `templates/` and fail
unless each one provides `template.manifest.json`, `dist/build-metrics.json`, `dist/artifact.json`
and `dist/manifest.json`. For each template the gate MUST verify that the manifest is valid, its
`id` equals the directory name, its `entry` and `previewFixture` files exist in `dist/`, the preview
fixture passes full payload validation, the measured metrics are within budget, `artifact.json`
has a 64-character lowercase hexadecimal `contentHash` and the manifest's `id` and `version`, and
`dist/manifest.json` equals the source manifest. Templates SHALL be built before this gate runs.

#### Scenario: Conforming template

- **WHEN** `templates/memory-box-spike` is built and its artifacts satisfy every check
- **THEN** the gate passes

#### Scenario: Over-budget or invalid template

- **WHEN** a template's measured `initialJsKbGzip` exceeds its manifest budget, its preview fixture
  fails validation, or its manifest `id` differs from its directory name
- **THEN** the CI test run fails

#### Scenario: Missing build output

- **WHEN** a template directory lacks `dist/build-metrics.json` or `dist/artifact.json`
- **THEN** the CI test run fails naming the missing file
