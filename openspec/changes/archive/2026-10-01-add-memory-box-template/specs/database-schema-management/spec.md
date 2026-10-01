# Spec Delta

## MODIFIED Requirements

### Requirement: Template catalog seed

The system SHALL provide `db:seed`, which runs migrations, then idempotently upserts the built-in
templates (`memory-box` at current version `1.1.0`, with its earlier version `1.0.0` kept as
`retired`; `our-timeline` and `midnight-wish` each at version `1.0.0`; each template with status
`published`, `sortOrder` `0`, `1`, `2` respectively), then verifies the schema. Each `templates`
document SHALL be keyed by the template id with `currentVersion`, `sortOrder`, `status` and
timestamps; each `templateVersions` document SHALL be keyed `<templateId>@<version>` with
`templateId`, `version`, `status`, `manifest`, `previewFixture`, `contentHash` (SHA-256 hex of the
serialized manifest) and timestamps. For documents inserted from now on, `manifest` is the manifest
as authored, and the serialized form is canonical JSON: object keys sorted recursively, no
whitespace, array order kept.

A template's preview fixture MUST validate against its manifest before it is written. `createdAt`
SHALL be preserved on re-seed.

When a `templateVersions` document already exists, `db:seed` SHALL compare the canonical JSON of
its stored `manifest` with the canonical JSON of the seed's manifest; key order MUST NOT matter.
When they differ, `db:seed` MUST fail with an error naming `<templateId>@<version>` and MUST NOT
modify that document. An existing document's `manifest`, `previewFixture` and `contentHash` MUST
stay exactly as first stored; re-seeding only updates its `status` and `updatedAt`.

#### Scenario: Seeding twice keeps one document per template

- **WHEN** `db:seed` is run twice
- **THEN** `templates` contains exactly one document each for `memory-box`, `our-timeline` and `midnight-wish`
- **AND** `templateVersions` contains `memory-box@1.0.0`, `memory-box@1.1.0`, `our-timeline@1.0.0`
  and `midnight-wish@1.0.0`

#### Scenario: Retiring the first Memory Box release

- **WHEN** `db:seed` runs against a database seeded before this change
- **THEN** `memory-box@1.0.0` has status `retired` and the same `contentHash` as before
- **AND** the `memory-box` document has `currentVersion` `1.1.0`

#### Scenario: Stored manifest with a different key order

- **WHEN** `db:seed` finds `memory-box@1.0.0` stored with the same manifest content in a different
  key order
- **THEN** seeding succeeds and the stored `manifest` and `contentHash` are unchanged

#### Scenario: Conflicting stored release

- **WHEN** `db:seed` finds `memory-box@1.1.0` stored with a manifest whose content differs from the
  seed's
- **THEN** the command fails naming `memory-box@1.1.0` and that document is unchanged
