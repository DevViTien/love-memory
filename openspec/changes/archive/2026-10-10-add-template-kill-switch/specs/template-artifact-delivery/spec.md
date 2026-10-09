# Spec Delta

## MODIFIED Requirements

### Requirement: Artifact route

The system SHALL serve artifact files with `GET` at
`/template-artifacts/{templateId}/{version}/{contentHash}/{fileName}`. A file MUST be served only
when an artifact exists for the exact `templateId` and `version`, that version is not killed
(`template-version-controls`), the path `contentHash` equals that artifact's `contentHash`, and
`fileName` is one of the artifact's files. The allowed file names are
`index.html`, served as `text/html; charset=utf-8`, and `runtime.mjs`, served as
`text/javascript; charset=utf-8`. Any other request under this path MUST return HTTP 404 with an
empty body.

#### Scenario: Serving the entry document and module

- **WHEN** `index.html` or `runtime.mjs` of `memory-box-spike` `0.1.0` is requested with the correct
  `contentHash`
- **THEN** the response is HTTP 200 with the file body and its content type

#### Scenario: Stale or wrong hash

- **WHEN** the request uses a `contentHash` that does not match the artifact (for example 64 zeros)
- **THEN** the response is HTTP 404

#### Scenario: Unknown file or version

- **WHEN** the request names a file outside the allowed set (for example `private.txt`) or an
  unknown version (for example `9.9.9`)
- **THEN** the response is HTTP 404

#### Scenario: Killed version

- **WHEN** `index.html` of `memory-box` `1.1.0` is requested with its correct `contentHash` after an
  admin killed that version
- **THEN** the response is HTTP 404 with an empty body, and after a restore it is served again
