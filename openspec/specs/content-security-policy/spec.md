# Content Security Policy

## Purpose

Defines the route-specific Content Security Policy (CSP) and the baseline HTTP security headers
that the web application attaches to its responses. It covers how a request path selects a policy
mode (static-compatible, per-request nonce, or isolated template document), the directives each mode
emits, how the nonce reaches the renderer, and the rendering constraint that nonce routes impose.
Access control for technical-spike pages is out of scope (see `technical-spikes`).

## Requirements

### Requirement: Route-based policy mode selection

The system SHALL select exactly one CSP mode per request path:

- `template` for `/template-spikes`, any path under `/template-spikes/`, and any path under
  `/template-artifacts/`;
- `nonce` for `/studio`, any path under `/studio/`, any path under `/viewer/`, `/preview`, any path
  under `/preview/`, `/g`, and any path under `/g/`;
- `static` for every other path (for example `/`, `/templates`, `/templates/memory-box`,
  `/auth/sign-in`).

The template classification SHALL take precedence over the other rules.

#### Scenario: Public catalog uses the static policy

- **WHEN** a browser requests `/` or `/templates/memory-box`
- **THEN** the response `Content-Security-Policy` is the static-compatible policy
- **AND** it contains neither `'strict-dynamic'` nor a `'nonce-` source

#### Scenario: Studio and Viewer use the nonce policy

- **WHEN** a browser requests `/studio`, `/studio/new`, `/g/a-public-gift-slug` or `/viewer/memory-box-spike/0.1.0`
- **THEN** the response `Content-Security-Policy` is the nonce policy containing `'strict-dynamic'`

#### Scenario: Preview uses the nonce policy

- **WHEN** a browser requests `/preview/` followed by a 43-character token, whether or not the token is valid
- **THEN** the response `Content-Security-Policy` is the nonce policy containing `'strict-dynamic'`

#### Scenario: Look-alike path stays static

- **WHEN** a browser requests `/previews` or `/preview-guide`
- **THEN** the response `Content-Security-Policy` is the static-compatible policy

#### Scenario: Template documents use the template policy

- **WHEN** a browser requests `/template-spikes/memory-box` or `/template-artifacts/memory-box-spike/0.1.0/<contentHash>/index.html`
- **THEN** the response `Content-Security-Policy` is the template policy

### Requirement: Static-compatible application policy

The system SHALL send, for `static` mode in a production build, a policy that allows
framework-generated inline scripts without nonces so that prerendered pages keep working. The
directives SHALL be, in this order:
`default-src 'self'`; `base-uri 'self'`; `connect-src` (see the asset and upload origins
requirement); `font-src 'self' data:`; `form-action 'self'`; `frame-ancestors 'none'`; `img-src`;
`media-src`; `object-src 'none'`; `script-src 'self' 'unsafe-inline'`;
`style-src 'self' 'unsafe-inline'`; `worker-src 'self' blob:`.

#### Scenario: Static policy allows inline framework scripts

- **WHEN** a production server responds to a `static`-mode page
- **THEN** the policy contains `script-src 'self' 'unsafe-inline'`
- **AND** the policy contains `frame-ancestors 'none'` and `object-src 'none'`
- **AND** the policy contains no `'strict-dynamic'` and no `'nonce-` source

### Requirement: Per-request nonce policy

The system SHALL, for `nonce` mode, generate a fresh nonce for every request (the base64 encoding of
a random UUID) and emit `script-src 'self' 'nonce-<nonce>' 'strict-dynamic'`. In a production build
the style directive SHALL be `style-src 'self' 'nonce-<nonce>'` and the policy SHALL NOT contain
`'unsafe-inline'`. All other directives SHALL match the static-compatible policy. A nonce policy
MUST NOT be produced without a nonce.

#### Scenario: Studio page receives a strict nonce policy

- **WHEN** a production server responds to `/studio/new?template=memory-box`
- **THEN** the policy contains `'nonce-<nonce>' 'strict-dynamic'`
- **AND** the policy does not contain `'unsafe-inline'`
- **AND** every `<script>` element rendered in the page carries a non-empty nonce

#### Scenario: Nonce changes per request

- **WHEN** the same nonce-mode path is requested twice
- **THEN** each response carries a different nonce value in its policy

### Requirement: Nonce propagation to the renderer

The system SHALL forward the computed policy to the renderer as the `Content-Security-Policy`
request header and, only in `nonce` mode, forward the nonce as the `x-nonce` request header. Any
`x-nonce` header supplied by the client MUST be discarded before rendering. The same policy SHALL be
set as the `Content-Security-Policy` response header.

#### Scenario: Client-supplied nonce is ignored

- **WHEN** a client sends a request with its own `x-nonce` header to a `static`-mode page
- **THEN** the renderer receives no `x-nonce` header
- **AND** the response policy contains no `'nonce-` source

#### Scenario: Nonce-mode request forwards the nonce

- **WHEN** a request for a `nonce`-mode path is processed
- **THEN** the renderer receives `x-nonce` equal to the nonce embedded in the response policy

### Requirement: Nonce routes are dynamically rendered

The system SHALL render every page that is served with a `nonce`-mode policy per request and MUST
NOT serve such a page from a prerendered (static) build output, because a nonce can only be applied
while rendering. The entire `/studio`, `/viewer`, `/preview` and `/g` route trees SHALL explicitly
opt out of prerendering in their layouts rather than relying on incidental dynamic APIs in
individual pages.

#### Scenario: Studio is never prerendered

- **WHEN** the application is built with `next build`
- **THEN** no page under `/studio` is emitted as static output
- **AND** each request to a Studio page renders with the nonce from that request

#### Scenario: Viewer is never prerendered

- **WHEN** the application is built with `next build`
- **THEN** no page under `/viewer` is emitted as static output
- **AND** each request to a Viewer page renders with the nonce from that request

#### Scenario: Preview is never prerendered

- **WHEN** the application is built with `next build`
- **THEN** no page under `/preview` is emitted as static output
- **AND** each request to a preview page renders with the nonce from that request

#### Scenario: Public gift page is never prerendered

- **WHEN** the application is built with `next build`
- **THEN** no page under `/g` is emitted as static output
- **AND** each request to `/g/{shareId}` renders with the nonce from that request

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

### Requirement: Development relaxations

The system SHALL treat every runtime whose `NODE_ENV` is not `production` as development and, for
`static` and `nonce` modes only, SHALL append `'unsafe-eval'` to `script-src` and use
`style-src 'self' 'unsafe-inline'` in place of the nonce-based style source. Production builds MUST
NOT include `'unsafe-eval'`.

#### Scenario: Development server allows eval for tooling

- **WHEN** a page is served with `NODE_ENV` set to `development`
- **THEN** its `script-src` contains `'unsafe-eval'`

#### Scenario: Production excludes eval

- **WHEN** a page is served with `NODE_ENV` set to `production`
- **THEN** its policy does not contain `'unsafe-eval'`

### Requirement: Policy application scope

The system SHALL attach the route-specific policy to page and document requests, and SHALL NOT
process paths beginning with `api`, `_next/static`, `_next/image` or `favicon.ico`, nor router
prefetch requests (requests with a `next-router-prefetch` header or `purpose: prefetch`).

#### Scenario: API routes are not given a page policy

- **WHEN** a client requests `/api/health`
- **THEN** the response is not assigned a route-specific CSP by the policy layer

### Requirement: Baseline security headers

The system SHALL send the following headers on every response, including API responses:
`Permissions-Policy: camera=(), geolocation=(), microphone=()`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff` and
`X-Frame-Options: DENY`. For paths under `/template-spikes/` and `/template-artifacts/` the
`X-Frame-Options` value SHALL be `SAMEORIGIN`, consistent with their `frame-ancestors 'self'`
policy. The `X-Powered-By` header MUST NOT be sent.

#### Scenario: Liveness endpoint carries baseline headers

- **WHEN** a client requests `/api/health`
- **THEN** the response includes `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY`
- **AND** no `X-Powered-By` header is present

#### Scenario: Template spike document may be framed by the same origin

- **WHEN** a client requests `/template-spikes/memory-box`
- **THEN** the response includes `X-Frame-Options: SAMEORIGIN`

#### Scenario: Template artifact may be framed by the same origin

- **WHEN** a client requests a file under `/template-artifacts/`
- **THEN** the response includes `X-Frame-Options: SAMEORIGIN`, not `DENY`
