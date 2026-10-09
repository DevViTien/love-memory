# Spec Delta

## MODIFIED Requirements

### Requirement: Route-based policy mode selection

The system SHALL select exactly one CSP mode per request path:

- `template` for `/template-spikes`, any path under `/template-spikes/`, and any path under
  `/template-artifacts/`;
- `nonce` for `/studio`, any path under `/studio/`, any path under `/viewer/`, `/preview`, any path
  under `/preview/`, `/g`, any path under `/g/`, `/admin`, any path under `/admin/`, `/checkout`,
  any path under `/checkout/`, and any path under `/billing/`;
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

#### Scenario: Admin pages use the nonce policy

- **WHEN** a browser requests `/admin`, `/admin/mfa` or `/admin/audit`, whether or not it may see
  them
- **THEN** the response `Content-Security-Policy` is the nonce policy containing `'strict-dynamic'`,
  and `/administration-guide` stays static

#### Scenario: Checkout pages use the nonce policy

- **WHEN** `/checkout/return?order=…` or `/billing/fake-checkout/{paymentId}` is requested
- **THEN** the response `Content-Security-Policy` is the nonce policy
