# Spec Delta

## MODIFIED Requirements

### Requirement: Isolated template document policy

The system SHALL send, for `template` mode, a policy that denies network, form, object, worker and
cross-origin framing capabilities, independent of development or production mode:
`default-src 'none'`; `base-uri 'none'`; `connect-src 'none'`; `font-src 'none'`;
`form-action 'none'`; `frame-ancestors 'self'`; `img-src data: https://*.private.blob.vercel-storage.com`
followed by the configured asset origin when present and then, when the `local` storage driver is
active (see `local-object-storage`), by the local object route source: the local storage origin
followed by the path `/api/local-object-storage/`, never the bare application origin;
`media-src 'none'`; `object-src 'none'`; `script-src 'self'`; `style-src 'unsafe-inline'`;
`worker-src 'none'`. A source already listed SHALL NOT be repeated. The local object route source
MUST NOT be listed when the effective storage driver is not `local`, including when the `local`
driver is refused on Vercel.
Content-addressed template artifact responses SHALL carry this policy themselves.

#### Scenario: Template document can be framed only by the same origin

- **WHEN** a template document is served
- **THEN** its policy contains `frame-ancestors 'self'` and `connect-src 'none'`
- **AND** its policy contains `script-src 'self'` without `'unsafe-inline'` or `'strict-dynamic'`

#### Scenario: Template images in local storage mode

- **WHEN** `STORAGE_DRIVER` is `local`, `APP_URL` is `http://127.0.0.1:3100` and a template
  artifact document is served
- **THEN** its policy contains `img-src data: https://*.private.blob.vercel-storage.com http://127.0.0.1:3100/api/local-object-storage/`
- **AND** its `img-src` does not contain the bare origin `http://127.0.0.1:3100` as a source
- **AND** its policy still contains `connect-src 'none'`

#### Scenario: Refused local driver adds no origin

- **WHEN** `VERCEL_ENV` is `production`, `STORAGE_DRIVER` is `local` and a template artifact
  document is served
- **THEN** its `img-src` is `data: https://*.private.blob.vercel-storage.com` followed only by the
  configured asset origin when present

### Requirement: Asset and upload origins

The system SHALL build the application (`static` and `nonce`) media sources as
`'self' blob: https://*.private.blob.vercel-storage.com` followed by the configured `ASSET_ORIGIN`
(normalized to its origin) when set, and then by the local storage origin when the `local` storage
driver is active (see `local-object-storage`); an origin already listed SHALL NOT be repeated, and
the local storage origin MUST NOT be listed when the effective storage driver is not `local`. The
system SHALL use the media sources as follows:

- `img-src`: media sources plus `data:`;
- `media-src`: media sources;
- `connect-src`: media sources plus `https://blob.vercel-storage.com` and the scoped path
  `https://vercel.com/api/blob/` (never the bare `https://vercel.com` origin).

#### Scenario: Configured asset origin is allowed

- **WHEN** `ASSET_ORIGIN` is `https://cdn.example/assets` and a Studio page is served
- **THEN** the policy contains `connect-src 'self' blob: https://*.private.blob.vercel-storage.com https://cdn.example https://blob.vercel-storage.com https://vercel.com/api/blob/`
- **AND** `img-src` and `media-src` include `https://cdn.example`

#### Scenario: No asset origin configured

- **WHEN** `ASSET_ORIGIN` is unset or empty and the storage driver is `vercel-blob`
- **THEN** `img-src` is `'self' blob: https://*.private.blob.vercel-storage.com data:`

#### Scenario: Local storage origin is allowed for uploads and images

- **WHEN** `STORAGE_DRIVER` is `local`, `APP_URL` is `http://localhost:3000`, `ASSET_ORIGIN` is
  unset and a Studio page is served
- **THEN** the policy contains `connect-src 'self' blob: https://*.private.blob.vercel-storage.com http://localhost:3000 https://blob.vercel-storage.com https://vercel.com/api/blob/`
- **AND** `img-src` and `media-src` include `http://localhost:3000`

#### Scenario: Local origin equal to the asset origin is listed once

- **WHEN** `STORAGE_DRIVER` is `local`, both `APP_URL` and `ASSET_ORIGIN` have the origin
  `http://localhost:3000` and a Studio page is served
- **THEN** `http://localhost:3000` appears exactly once in `img-src`

#### Scenario: Refused local driver adds no application origin

- **WHEN** `VERCEL_ENV` is `preview`, `STORAGE_DRIVER` is `local` and `ASSET_ORIGIN` is unset
- **THEN** `img-src` is `'self' blob: https://*.private.blob.vercel-storage.com data:`
