# Spec Delta

## MODIFIED Requirements

### Requirement: Plan availability

The system SHALL make a plan available to an owner for a first publish as follows:

- `free` SHALL be available to every signed-in owner, in every environment including Vercel
  Production;
- `standard` SHALL be available through checkout while a billing provider is configured
  (`billing-checkout` "Billing provider configuration"): it is published only after a paid order,
  never by the publish endpoint alone;
- otherwise, `standard` SHALL be available without payment while the internal paid-plan grant is on
  (see "Internal paid-plan grant");
- otherwise `standard` is unavailable.

A plan available through checkout SHALL be refused by the publish endpoint with `details.reason`
`PAYMENT_REQUIRED`, and offered with its price by the Studio. An unavailable plan SHALL be refused
by the publish endpoint (`gift-publishing` "Pre-publish
checks") and shown as unavailable in the Studio (`studio-editor`).

#### Scenario: Free in Production

- **WHEN** `VERCEL_ENV` is `production` and a signed-in owner publishes a complete 3-photo draft on
  plan `free`
- **THEN** the gift is published

#### Scenario: Standard without the internal grant

- **WHEN** no billing provider is configured, the internal paid-plan grant is off, and an owner
  publishes on plan `standard`
- **THEN** the publish is refused with `details.reason` `PLAN_NOT_AVAILABLE`, and nothing is written

#### Scenario: Standard through checkout

- **WHEN** the fake billing provider is configured and an owner publishes a complete draft directly
  on plan `standard`
- **THEN** the publish is refused with `details.reason` `PAYMENT_REQUIRED`, nothing is written, and
  a checkout for `standard` is accepted
