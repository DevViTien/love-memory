# Template Artifact Delivery

## Purpose

Template artifacts are the built, runnable files of one exact template release. This capability
covers how a build produces immutable, content-addressed artifacts and metadata, and how the web
app serves them under a URL that pins template id, version and content hash, with caching and a
network-denying Content Security Policy. Executing an artifact inside the Viewer is specified by
`template-viewer-runtime`; manifest validation and budgets by `template-manifest-contract`.

## Requirements

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

### Requirement: Artifact route

The system SHALL serve artifact files with `GET` at
`/template-artifacts/{templateId}/{version}/{contentHash}/{fileName}`. A file MUST be served only
when an artifact exists for the exact `templateId` and `version`, the path `contentHash` equals that
artifact's `contentHash`, and `fileName` is one of the artifact's files. The allowed file names are
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

### Requirement: Immutable caching and integrity headers

The system SHALL send every successful artifact response with
`Cache-Control: public, max-age=31536000, immutable`, an `ETag` whose value is the double-quoted
lowercase hexadecimal SHA-256 of that file's body, `X-Content-Type-Options: nosniff`, and
`Access-Control-Allow-Origin: *` so the sandboxed, opaque-origin document can load its module
script. When the `local` storage driver is active (see `local-object-storage`), the artifact's
Content Security Policy depends on the environment, so successful artifact responses SHALL instead
carry `Cache-Control: no-store`, keeping the same `ETag`, `X-Content-Type-Options` and
`Access-Control-Allow-Origin` values; this MUST NOT apply when the effective storage driver is not
`local`.

#### Scenario: Cache and integrity headers

- **WHEN** a valid artifact file is fetched and the storage driver is `vercel-blob`
- **THEN** `Cache-Control` contains `immutable`, `ETag` matches `"<64 hex characters>"`, and
  `Access-Control-Allow-Origin` is `*`

#### Scenario: Local storage mode is not cached

- **WHEN** a valid artifact file is fetched while `STORAGE_DRIVER` is `local` and allowed
- **THEN** `Cache-Control` is `no-store` and does not contain `immutable`
- **AND** `ETag` still matches `"<64 hex characters>"`

#### Scenario: Refused local driver keeps immutable caching

- **WHEN** a valid artifact file is fetched while `VERCEL_ENV` is `production` and `STORAGE_DRIVER`
  is `local`
- **THEN** `Cache-Control` is `public, max-age=31536000, immutable`

#### Scenario: Not-found response is not an artifact

- **WHEN** an artifact request returns HTTP 404
- **THEN** it carries no artifact body and no artifact `ETag`

### Requirement: Network-denying artifact CSP

The system SHALL send artifact responses, and every response under `/template-artifacts/` and
`/template-spikes`, with the template Content Security Policy:
`default-src 'none'`, `base-uri 'none'`, `connect-src 'none'`, `font-src 'none'`,
`form-action 'none'`, `frame-ancestors 'self'`, `img-src data:` plus
`https://*.private.blob.vercel-storage.com`, the configured asset origin when one is set, and the
local object route source (the local storage origin followed by `/api/local-object-storage/`) when
the `local` storage driver is active (see `local-object-storage`),
`media-src 'none'`, `object-src 'none'`, `script-src 'self'`, `style-src 'unsafe-inline'` and
`worker-src 'none'`. Artifact code MUST therefore be unable to open network connections, submit
forms, load fonts, media or workers, or be framed by another origin, and MUST NOT be able to load
images from the application origin other than signed local object URLs, and those only while the
`local` storage driver is active.

#### Scenario: Artifact denies network access

- **WHEN** a valid artifact file is fetched
- **THEN** its `Content-Security-Policy` contains `connect-src 'none'` and `default-src 'none'`

#### Scenario: Artifact may show locally stored images

- **WHEN** a valid artifact file is fetched while `STORAGE_DRIVER` is `local` and `APP_URL` is
  `http://127.0.0.1:3100`
- **THEN** its `img-src` contains `http://127.0.0.1:3100/api/local-object-storage/` and not the
  bare origin `http://127.0.0.1:3100`
- **AND** it still contains `connect-src 'none'`

#### Scenario: Runtime attempts an unexpected request

- **WHEN** the reference artifact runs in the Viewer
- **THEN** the only subresource requested from the artifact frame is its `runtime.mjs` module

### Requirement: Technical spike artifact routes

The system SHALL serve the reference template's entry document at `/template-spikes/memory-box` and
its runtime module at `/template-spikes/runtime.mjs` only when technical spikes are enabled
(`TECHNICAL_SPIKES_ENABLED` is `true`, which also requires `TECHNICAL_SPIKE_TOKEN`). These
responses MUST use `Cache-Control: private, no-store`, MUST be frameable only by the same origin
(`X-Frame-Options: SAMEORIGIN`) and MUST carry the template CSP. When technical spikes are disabled
both routes MUST return HTTP 404 with `Cache-Control: private, no-store`.

#### Scenario: Spikes disabled

- **WHEN** `TECHNICAL_SPIKES_ENABLED` is `false` and `/template-spikes/memory-box` or
  `/template-spikes/runtime.mjs` is requested
- **THEN** the response is HTTP 404 with `Cache-Control: private, no-store`

#### Scenario: Spikes enabled

- **WHEN** technical spikes are enabled and `/template-spikes/memory-box` is requested
- **THEN** the response is the uncached entry document referencing `runtime.mjs`, with
  `X-Frame-Options: SAMEORIGIN` and a CSP containing `connect-src 'none'`

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
