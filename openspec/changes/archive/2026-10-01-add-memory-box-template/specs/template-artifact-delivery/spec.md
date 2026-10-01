# Spec Delta

## ADDED Requirements

### Requirement: Committed template releases

The system SHALL serve every released template version from committed release files, never from a
rebuild of the template source. A release of template `{id}` version `{version}` is the directory
`templates/{id}/releases/{version}/` containing `index.html`, `runtime.mjs`, `manifest.json`,
`preview.fixture.json`, `build-metrics.json` and `artifact.json`, copied from a build of that
version. A release step SHALL create the directory from `dist/` and MUST refuse to run, writing
nothing, when:

- the directory already exists;
- `dist/manifest.json` is not canonically equal to the workspace's `template.manifest.json`;
- `dist/artifact.json` has a `contentHash` other than the hash of `dist/index.html` and
  `dist/runtime.mjs`, or an `id` or `version` other than the manifest's.

The release step SHALL write into a staging directory and move it into place only after every file
was written, so a failed run leaves no partial release and can be rerun.

The test suite MUST fail for a release in any of these cases:

- its `contentHash` computed from `index.html` and `runtime.mjs` differs from its `artifact.json`
  or from the value recorded when the version was released;
- the SHA-256 of any committed file in the release directory differs from the value recorded when
  the version was released, or the directory gains or loses a file;
- its `manifest.json` is not canonically equal to the workspace's `template.manifest.json` while
  both have the same version;
- its `build-metrics.json` exceeds its manifest budgets;
- its preview fixture fails full payload validation against its manifest.

Formatters and linters MUST NOT rewrite release files. The source build in `dist/` SHALL NOT be
served for a version that has a release.

#### Scenario: Release step on an existing release

- **WHEN** the release step runs for `memory-box` `1.1.0` and `templates/memory-box/releases/1.1.0/`
  already exists
- **THEN** it fails without writing any file

#### Scenario: Release step on an inconsistent build

- **WHEN** the release step runs and `dist/artifact.json` has a `contentHash` that does not match
  `dist/index.html` and `dist/runtime.mjs`, or `dist/manifest.json` has another version than
  `template.manifest.json`
- **THEN** it fails without creating the release directory

#### Scenario: Release step fails while writing

- **WHEN** writing one of the release files fails
- **THEN** no release directory and no staging directory remain, and rerunning the release step
  creates the release

#### Scenario: Tampered release

- **WHEN** `templates/memory-box/releases/1.1.0/runtime.mjs` is edited and `artifact.json` is updated
  to the new hash
- **THEN** the test suite fails because the hash differs from the value recorded at release

#### Scenario: Tampered release metadata

- **WHEN** `templates/memory-box/releases/1.1.0/build-metrics.json` or `preview.fixture.json` is
  edited
- **THEN** the test suite fails because that file's SHA-256 differs from the value recorded at
  release

#### Scenario: Source changes after release

- **WHEN** the `templates/memory-box` source or its build toolchain changes after `1.1.0` was
  released
- **THEN** the files served for `memory-box` `1.1.0` stay byte-identical

## MODIFIED Requirements

### Requirement: Content-addressed artifact identity

The system SHALL identify every servable template artifact by its exact template `id`, exact
`version` and a `contentHash` that is the lowercase hexadecimal SHA-256 (64 characters) of the
artifact's HTML document, a NUL separator, and its runtime module, in that order. An artifact
release MUST be resolvable only by exact `id` and `version`; no range, alias or "latest" lookup
SHALL exist. The artifacts available today are `memory-box-spike` version `0.1.0` and `memory-box`
version `1.1.0`. A template version without a built artifact, such as the retired `memory-box`
`1.0.0`, MUST NOT resolve to an artifact.

#### Scenario: Exact version lookup

- **WHEN** artifact `memory-box-spike` version `0.1.0` or `memory-box` version `1.1.0` is requested
- **THEN** it resolves with a 64-character lowercase hexadecimal `contentHash`

#### Scenario: Unknown version

- **WHEN** artifact `memory-box-spike` version `0.2.0`, or `memory-box` version `1.0.0` or `1.1`,
  is requested
- **THEN** no artifact is resolved

#### Scenario: Registry serves the committed release

- **WHEN** artifact `memory-box` version `1.1.0` is resolved
- **THEN** its files are the committed files of `templates/memory-box/releases/1.1.0/` and its
  `contentHash` equals that directory's `artifact.json` `contentHash`

### Requirement: Template build output and metadata

The system SHALL, when a template workspace is built, write to its `dist/` directory the entry
document `index.html`, the runtime module `runtime.mjs`, the preview fixture, a copy of the source
manifest as `manifest.json`, measured metrics as `build-metrics.json`, and artifact metadata as
`artifact.json`. The runtime module MUST be a single self-contained ES module that imports no other
module. `artifact.json` MUST contain `contentHash`, `engineVersion`, `entry`, `id` and `version`,
with `engineVersion`, `entry`, `id` and `version` copied from the manifest. `build-metrics.json`
MUST contain `initialJsKbGzip` measured as the gzip size of the runtime module in kilobytes (three
decimal places), plus `initialMediaKb` and `maxTextureMb`. The root command `build:templates` SHALL
build every template workspace under `templates/` and MUST fail when any of those builds fails.

#### Scenario: Building the reference template

- **WHEN** `templates/memory-box-spike` is built
- **THEN** `dist/artifact.json` has `id` `memory-box-spike`, `version` `0.1.0`, `entry`
  `index.html`, `engineVersion` `1.0.0` and a 64-character `contentHash`

#### Scenario: Building Memory Box

- **WHEN** `build:templates` runs
- **THEN** both `templates/memory-box-spike` and `templates/memory-box` are built, and
  `templates/memory-box/dist/artifact.json` has `id` `memory-box`, `version` `1.1.0`, `entry`
  `index.html` and `engineVersion` `1.0.0`

#### Scenario: Artifact content changes

- **WHEN** the entry document or runtime module content changes and the template is rebuilt
- **THEN** the `contentHash` in `artifact.json` changes

#### Scenario: One template fails to build

- **WHEN** any template workspace build fails, for example because its runtime cannot be bundled
- **THEN** `build:templates` exits with a failure and the test run that depends on it does not start
