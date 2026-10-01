# Spec Delta

## MODIFIED Requirements

### Requirement: Seeded launch templates

The system SHALL provide a seed command (`db:seed`) that idempotently upserts three published
templates in this `sortOrder`:

- `memory-box` (`Hộp ký ức`) at current version `1.1.0`;
- `our-timeline` (`Dòng thời gian hai đứa`) at version `1.0.0`;
- `midnight-wish` (`Bầu trời lời nhắn`) at version `1.0.0`.

The `memory-box` `1.1.0` manifest and preview fixture MUST be the ones of the committed release
`templates/memory-box/releases/1.1.0/`. The seed SHALL also keep the earlier release `memory-box` `1.0.0`, with its
original manifest and preview fixture, as a version with status `retired`.

Seeding MUST:

- set each template's `currentVersion` and status from its current version's manifest;
- store every version under the identity `{templateId}@{version}` together with its manifest and
  preview fixture;
- abort if a template has no preview fixture, or its preview fixture fails payload validation
  against the manifest;
- abort, without changing that version, when a version is already stored with a manifest whose
  content differs, ignoring key order, because a template release is immutable.

#### Scenario: Seed on an empty database

- **WHEN** `db:seed` runs against an empty database
- **THEN** the catalog lists `memory-box` at version `1.1.0`, then `our-timeline` and
  `midnight-wish` each at version `1.0.0`, in that order
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
