## MODIFIED Requirements

### Requirement: Isolated template document policy

The system SHALL send, for `template` mode, a policy that denies network, form, object, worker and
cross-origin framing capabilities, independent of development or production mode:
`default-src 'none'`; `base-uri 'none'`; `connect-src 'none'`; `font-src` with only the artifact
origin's `/template-artifacts/` path, or `font-src 'none'` when no artifact origin is given;
`form-action 'none'`; `frame-ancestors 'self'`; `img-src data:` followed by that
`/template-artifacts/` path when given, and by `https://*.private.blob.vercel-storage.com` (without an
artifact origin: `img-src data: https://*.private.blob.vercel-storage.com`)
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
- **THEN** its policy contains `img-src data: http://127.0.0.1:3100/template-artifacts/ https://*.private.blob.vercel-storage.com http://127.0.0.1:3100/api/local-object-storage/`
- **AND** its `img-src` does not contain the bare origin `http://127.0.0.1:3100` as a source
- **AND** its policy still contains `connect-src 'none'`

#### Scenario: Refused local driver adds no origin

- **WHEN** `VERCEL_ENV` is `production`, `STORAGE_DRIVER` is `local` and a template artifact
  document is served
- **THEN** its `img-src` is `data:`, the artifact origin's `/template-artifacts/` path and
  `https://*.private.blob.vercel-storage.com`, followed only by the configured asset origin when
  present

#### Scenario: Template's own fonts and images

- **WHEN** a template document is served
- **THEN** its fonts and images may come only from the artifact origin's `/template-artifacts/`
  path (plus `data:` and the photo origins), never from another route such as `/api/`, and a
  response under `/template-artifacts/` carries `sandbox allow-scripts`
