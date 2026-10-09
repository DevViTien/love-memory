# Spec Delta

## MODIFIED Requirements

### Requirement: Baseline security headers

The system SHALL send the following headers on every response, including API responses:
`Permissions-Policy: camera=(), geolocation=(), microphone=()`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Strict-Transport-Security: max-age=63072000`,
`Cross-Origin-Opener-Policy: same-origin` and `X-Permitted-Cross-Domain-Policies: none`. For paths under `/template-spikes/` and `/template-artifacts/` the
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

#### Scenario: Transport security on every response

- **WHEN** a client requests `/` or `/api/health`
- **THEN** the response includes `Strict-Transport-Security: max-age=63072000` and
  `Cross-Origin-Opener-Policy: same-origin`
