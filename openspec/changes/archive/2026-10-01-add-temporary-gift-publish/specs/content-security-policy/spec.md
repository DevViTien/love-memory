# Spec Delta

## MODIFIED Requirements

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
