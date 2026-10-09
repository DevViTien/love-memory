# Spec Delta

## MODIFIED Requirements

### Requirement: Gift entitlement snapshot

A gift's first successful publish SHALL grant it an entitlement in the same transaction as its first
publication. The entitlement SHALL hold exactly:

- the plan's `planId`, `planVersion`, `priceVnd`, `maxPhotos`, `watermark`, `retentionDays`,
  `passwordAccess` and `scheduledAccess`;
- the grant `source`: `free` for the Free plan, or `order` for a plan paid by an order
  (`billing-checkout` "Paid order fulfillment"). Entitlements granted earlier keep their source:
  `internal` (the retired internal paid-plan grant) or `legacy` (the schema migration backfill);
- `grantedAt`, the time of the first publication.

It SHALL also set the gift's `expiresAt` to `grantedAt` plus `retentionDays` days. Updates of a
published gift (`gift-publishing`) SHALL keep the entitlement and `expiresAt` unchanged and cost
nothing. No API SHALL change a granted entitlement. Every check of a published gift against its
plan SHALL read the gift's entitlement, never the current catalog. A draft has neither an
entitlement nor an `expiresAt`.

#### Scenario: Free entitlement granted

- **WHEN** an owner first publishes a draft on plan `free` at `2026-10-08T10:00:00Z`
- **THEN** the gift's entitlement holds `planId` `free`, `planVersion` `1`, `priceVnd` `0`,
  `maxPhotos` `3`, `watermark` `true`, `retentionDays` `14`, `source` `free` and `grantedAt`
  `2026-10-08T10:00:00Z`
- **AND** its `expiresAt` is `2026-10-22T10:00:00Z`

#### Scenario: Update keeps the entitlement

- **WHEN** the owner of that gift publishes an update on `2026-10-15`
- **THEN** the entitlement and `expiresAt` are unchanged

#### Scenario: Catalog change does not touch granted gifts

- **WHEN** a later release adds `free` version `2` with `maxPhotos` `5`
- **THEN** a gift granted `free` version `1` is still limited to 3 photos

#### Scenario: Draft has no entitlement

- **WHEN** a draft is read through the draft API
- **THEN** its `publication` is `null`, and nothing in the response describes a plan

#### Scenario: Paid entitlement granted

- **WHEN** a gift's paid `standard` order is fulfilled
- **THEN** the gift's entitlement holds `planId` `standard`, the order's `planVersion`, and
  `source` `order`

### Requirement: Plan availability

The system SHALL make a plan available to an owner for a first publish as follows:

- `free` SHALL be available to every signed-in owner, in every environment including Vercel
  Production;
- `standard` SHALL be available through checkout while a billing provider is configured
  (`billing-checkout` "Billing provider configuration"): it is published only after a paid order,
  never by the publish endpoint alone;
- otherwise `standard` is unavailable;
- a plan the gift's owner already paid for (a `paid` order of the gift) SHALL be available for that
  gift on the order's plan version, without another checkout.

A plan available through checkout SHALL be refused by the publish endpoint with `details.reason`
`PAYMENT_REQUIRED`, and offered with its price by the Studio. An unavailable plan SHALL be refused
by the publish endpoint (`gift-publishing` "Pre-publish
checks") and shown as unavailable in the Studio (`studio-editor`).

#### Scenario: Free in Production

- **WHEN** `VERCEL_ENV` is `production` and a signed-in owner publishes a complete 3-photo draft on
  plan `free`
- **THEN** the gift is published

#### Scenario: Standard without the internal grant

- **WHEN** no billing provider is configured, `INTERNAL_PLAN_GRANT_ENABLED` is still `true` on the
  deployment, and an owner publishes on plan `standard`
- **THEN** the publish is refused with `details.reason` `PLAN_NOT_AVAILABLE`, and nothing is written,
  because no grant without payment exists any more

#### Scenario: Standard through checkout

- **WHEN** the fake billing provider is configured and an owner publishes a complete draft directly
  on plan `standard`
- **THEN** the publish is refused with `details.reason` `PAYMENT_REQUIRED`, nothing is written, and
  a checkout for `standard` is accepted

## REMOVED Requirements

### Requirement: Internal paid-plan grant

**Reason**: Checkout and fulfillment now grant paid plans (`billing-checkout`). A grant without
payment must not exist on any tier.

**Migration**: Remove `INTERNAL_PLAN_GRANT_ENABLED` from every environment. Gifts granted through it
keep their entitlement (`source` `internal`).
