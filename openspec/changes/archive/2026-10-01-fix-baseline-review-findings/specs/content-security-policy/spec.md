## MODIFIED Requirements

### Requirement: Nonce routes are dynamically rendered

The system SHALL render every page that is served with a `nonce`-mode policy per request and MUST
NOT serve such a page from a prerendered (static) build output, because a nonce can only be applied
while rendering. The entire `/studio` and `/viewer` route trees SHALL explicitly opt out of
prerendering in their layouts rather than relying on incidental dynamic APIs in individual pages.

#### Scenario: Studio is never prerendered

- **WHEN** the application is built with `next build`
- **THEN** no page under `/studio` is emitted as static output
- **AND** each request to a Studio page renders with the nonce from that request

#### Scenario: Viewer is never prerendered

- **WHEN** the application is built with `next build`
- **THEN** no page under `/viewer` is emitted as static output
- **AND** each request to a Viewer page renders with the nonce from that request

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
