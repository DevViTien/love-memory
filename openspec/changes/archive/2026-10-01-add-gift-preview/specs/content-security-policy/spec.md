# Spec Delta

## MODIFIED Requirements

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

### Requirement: Nonce routes are dynamically rendered

The system SHALL render every page that is served with a `nonce`-mode policy per request and MUST
NOT serve such a page from a prerendered (static) build output, because a nonce can only be applied
while rendering. The entire `/studio`, `/viewer` and `/preview` route trees SHALL explicitly opt out
of prerendering in their layouts rather than relying on incidental dynamic APIs in individual pages.

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
