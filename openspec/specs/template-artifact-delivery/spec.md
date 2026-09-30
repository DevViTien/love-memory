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
SHALL exist. The artifacts available today are `memory-box-spike` version `0.1.0`.

#### Scenario: Exact version lookup

- **WHEN** artifact `memory-box-spike` version `0.1.0` is requested
- **THEN** it resolves with a 64-character lowercase hexadecimal `contentHash`

#### Scenario: Unknown version

- **WHEN** artifact `memory-box-spike` version `0.2.0` is requested
- **THEN** no artifact is resolved

### Requirement: Template build output and metadata

The system SHALL, when a template workspace is built, write to its `dist/` directory the entry
document `index.html`, the runtime module `runtime.mjs`, the preview fixture, a copy of the source
manifest as `manifest.json`, measured metrics as `build-metrics.json`, and artifact metadata as
`artifact.json`. `artifact.json` MUST contain `contentHash`, `engineVersion`, `entry`, `id` and
`version`, with `engineVersion`, `entry`, `id` and `version` copied from the manifest.
`build-metrics.json` MUST contain `initialJsKbGzip` measured as the gzip size of the runtime module
in kilobytes (three decimal places), plus `initialMediaKb` and `maxTextureMb`.

#### Scenario: Building the reference template

- **WHEN** `templates/memory-box-spike` is built
- **THEN** `dist/artifact.json` has `id` `memory-box-spike`, `version` `0.1.0`, `entry`
  `index.html`, `engineVersion` `1.0.0` and a 64-character `contentHash`

#### Scenario: Artifact content changes

- **WHEN** the entry document or runtime module content changes and the template is rebuilt
- **THEN** the `contentHash` in `artifact.json` changes

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
script.

#### Scenario: Cache and integrity headers

- **WHEN** a valid artifact file is fetched
- **THEN** `Cache-Control` contains `immutable`, `ETag` matches `"<64 hex characters>"`, and
  `Access-Control-Allow-Origin` is `*`

#### Scenario: Not-found response is not an artifact

- **WHEN** an artifact request returns HTTP 404
- **THEN** it carries no artifact body and no artifact `ETag`

### Requirement: Network-denying artifact CSP

The system SHALL send artifact responses, and every response under `/template-artifacts/` and
`/template-spikes`, with the template Content Security Policy:
`default-src 'none'`, `base-uri 'none'`, `connect-src 'none'`, `font-src 'none'`,
`form-action 'none'`, `frame-ancestors 'self'`, `img-src data:` plus
`https://*.private.blob.vercel-storage.com` and the configured asset origin when one is set,
`media-src 'none'`, `object-src 'none'`, `script-src 'self'`, `style-src 'unsafe-inline'` and
`worker-src 'none'`. Artifact code MUST therefore be unable to open network connections, submit
forms, load fonts, media or workers, or be framed by another origin.

#### Scenario: Artifact denies network access

- **WHEN** a valid artifact file is fetched
- **THEN** its `Content-Security-Policy` contains `connect-src 'none'` and `default-src 'none'`

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
