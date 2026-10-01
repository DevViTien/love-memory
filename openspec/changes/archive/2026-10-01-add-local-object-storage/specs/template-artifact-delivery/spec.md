# Spec Delta

## MODIFIED Requirements

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
