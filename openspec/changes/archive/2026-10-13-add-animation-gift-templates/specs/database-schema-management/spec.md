## MODIFIED Requirements

### Requirement: Template catalog seed

The system SHALL provide `db:seed`, which runs migrations, then idempotently upserts the built-in
template `memory-box` (at current version `1.1.0`, with its earlier version `1.0.0` kept as
`retired`; status `published`, `sortOrder` `0`). It no longer creates the `sdk`-era placeholders
`our-timeline` and `midnight-wish` (version `1.0.0`): where an earlier seed stored them, it sets
their `sdk` versions, and their `templates` documents while still current at that version, to
status `retired` and keeps their manifests, never touching an `html` version imported under these
ids (`template-catalog` "Seeded launch templates"; they were stored with `sortOrder` `1` and
`2` respectively), then verifies the schema. Each `templates`
document SHALL be keyed by the template id with `currentVersion`, `sortOrder`, `status` and
timestamps; each `templateVersions` document SHALL be keyed `<templateId>@<version>` with
`templateId`, `version`, `status`, `manifest`, `previewFixture`, `contentHash` (SHA-256 hex of the
serialized manifest) and timestamps. For documents inserted from now on, `manifest` is the manifest
as authored, and the serialized form is canonical JSON: object keys sorted recursively, no
whitespace, array order kept.

Before verifying the schema, `db:seed` SHALL also import the bundled `html` templates of
`templates-html/` (`love-days` with `sortOrder` `3`, see `template-artifact-delivery` "HTML template
import command"), then `envelope-letter`, `galaxy-text`, `heart-photo`, `matrix-text` and
`memories` with `sortOrder` `4` to `8`, in the order of `templates-html/catalog-order.json`
(`template-catalog` "Seeded launch templates"); this import needs the configured object storage. A
template already stored keeps its `sortOrder`.

A template's preview fixture MUST validate against its manifest before it is written. `createdAt`
SHALL be preserved on re-seed.

When a `templateVersions` document already exists, `db:seed` SHALL compare the canonical JSON of
its stored `manifest` with the canonical JSON of the seed's manifest; key order MUST NOT matter.
When they differ, `db:seed` MUST fail with an error naming `<templateId>@<version>` and MUST NOT
modify that document. An existing document's `manifest`, `previewFixture` and `contentHash` MUST
stay exactly as first stored; re-seeding only updates its `status` and `updatedAt`.

#### Scenario: Seeding twice keeps one document per template

- **WHEN** `db:seed` is run twice
- **THEN** `templates` contains exactly one document for `memory-box` and one for each bundled
  `html` template
- **AND** `templateVersions` contains `memory-box@1.0.0` and `memory-box@1.1.0`, and no
  `our-timeline@1.0.0` or `midnight-wish@1.0.0` on a database that never stored them

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

#### Scenario: Retiring the sdk-era placeholders

- **WHEN** `db:seed` runs against a database that stores `our-timeline@1.0.0` and
  `midnight-wish@1.0.0` as `published`
- **THEN** both versions and both `templates` documents have status `retired`, with the same
  `manifest` and `contentHash` as before, and a second run changes nothing more

#### Scenario: Seeding imports the bundled html templates

- **WHEN** `db:seed` runs with object storage configured
- **THEN** `templateVersions` also contains `love-days@1.0.0` with `kind` `html`, and `templates`
  contains `love-days` with `sortOrder` `3`
- **AND** `templateVersions` contains `envelope-letter@1.0.0`, `galaxy-text@1.0.0`,
  `heart-photo@1.0.0`, `matrix-text@1.0.0` and `memories@1.0.0` with `kind` `html`, and their
  `templates` documents have `sortOrder` `4`, `5`, `6`, `7` and `8`
