# Spec Delta

## MODIFIED Requirements

### Requirement: Artifact resolution

The `artifactUrl` SHALL be the content-addressed entry URL
`/template-artifacts/{templateId}/{version}/{contentHash}/index.html` of the exact template version
that the gift is bound to, when that exact version has a registered artifact and is not killed
(`template-version-controls`). `artifactUrl` SHALL be `null` in three cases:

- the version has no registered artifact, such as the retired `memory-box` `1.0.0`;
- the version is killed;
- an expected `contentHash` was supplied and differs from the registered one.

The rest of the output SHALL still be built, so the gift viewer shows the static rendering. The
transformation MUST NOT fall back to another version of the template, or to an artifact whose
`contentHash` differs from the expected one.

#### Scenario: Current Memory Box draft

- **WHEN** the gift is bound to `memory-box` `1.1.0` and no expected `contentHash` is supplied
- **THEN** `artifactUrl` is `/template-artifacts/memory-box/1.1.0/{contentHash}/index.html` with the
  registered 64-character `contentHash`

#### Scenario: Version without an artifact

- **WHEN** the gift is bound to `memory-box` `1.0.0`
- **THEN** `artifactUrl` is `null`, and `payload`, `assets`, `fields` and `issues` are still returned
- **AND** no artifact of `memory-box` `1.1.0` is used instead

#### Scenario: Pinned artifact matches

- **WHEN** the expected `contentHash` equals the registered `contentHash` of `memory-box` `1.1.0`
- **THEN** `artifactUrl` points to that artifact

#### Scenario: Pinned artifact differs

- **WHEN** the expected `contentHash` differs from the registered one
- **THEN** `artifactUrl` is `null` and the rest of the output is still returned

#### Scenario: Killed version

- **WHEN** the gift is bound to `memory-box` `1.1.0` and an admin has killed that version
- **THEN** `artifactUrl` is `null`, and `payload`, `assets`, `fields` and `issues` are still returned
