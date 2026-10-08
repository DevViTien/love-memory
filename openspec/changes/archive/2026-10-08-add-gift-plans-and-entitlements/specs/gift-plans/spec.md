# Spec Delta

## Purpose

Defines the plans a gift can be published on, the entitlement a gift receives when it is first
published, how long its share link stays open, and which plans an owner may choose before payment
exists. The server is the only source of truth for these values.

## ADDED Requirements

### Requirement: Plan catalog

The system SHALL offer exactly these plan versions, identified by `planId` and `planVersion`:

| `planId`   | `planVersion` | Name         | `priceVnd` | `maxPhotos` | `watermark` | `retentionDays` | `passwordAccess` | `scheduledAccess` |
| ---------- | ------------- | ------------ | ---------- | ----------- | ----------- | --------------- | ---------------- | ----------------- |
| `free`     | `1`           | `Miễn phí`   | `0`        | `3`         | `true`      | `14`            | `false`          | `false`           |
| `standard` | `1`           | `Tiêu chuẩn` | `49000`    | `null`      | `false`     | `365`           | `true`           | `true`            |

`priceVnd` is an integer amount in Vietnamese đồng. `maxPhotos` `null` means that only the
template's own limits apply. A released plan version MUST NOT change. Changing a price, limit or
capability SHALL release a new `planVersion`, and an entitlement already granted keeps the values
of the version it was granted from. The current version of each plan is the one offered for new
publishes. The catalog SHALL hold no other plan.

The photo count of a gift's content SHALL be the number of image items across all of the template's
image fields. It is counted from the content being published, never from uploaded assets.

#### Scenario: Plans offered

- **WHEN** an owner opens the `Xuất bản` step of a draft
- **THEN** exactly the plans `free` version `1` and `standard` version `1` are offered, with the
  values of the table

#### Scenario: Photo count

- **WHEN** a `memory-box` `1.1.0` gift's `memories` field holds 5 items
- **THEN** its photo count is `5`

### Requirement: Gift entitlement snapshot

A gift's first successful publish SHALL grant it an entitlement in the same transaction as its first
publication. The entitlement SHALL hold exactly:

- the plan's `planId`, `planVersion`, `priceVnd`, `maxPhotos`, `watermark`, `retentionDays`,
  `passwordAccess` and `scheduledAccess`;
- the grant `source`: `free` for the Free plan, `internal` for a paid plan granted by the internal
  paid-plan grant, or `legacy` for a gift backfilled by the schema migration;
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

### Requirement: Plan availability

Before payment exists, the system SHALL make a plan available to an owner for a first publish as
follows:

- `free` SHALL be available to every signed-in owner, in every environment including Vercel
  Production;
- `standard` SHALL be available only while the internal paid-plan grant is on (see "Internal
  paid-plan grant").

An unavailable plan SHALL be refused by the publish endpoint (`gift-publishing` "Pre-publish
checks") and shown as unavailable in the Studio (`studio-editor`).

#### Scenario: Free in Production

- **WHEN** `VERCEL_ENV` is `production` and a signed-in owner publishes a complete 3-photo draft on
  plan `free`
- **THEN** the gift is published

#### Scenario: Standard without the internal grant

- **WHEN** the internal paid-plan grant is off and an owner publishes on plan `standard`
- **THEN** the publish is refused with `details.reason` `PLAN_NOT_AVAILABLE`, and nothing is written

### Requirement: Internal paid-plan grant

The internal paid-plan grant SHALL be on only when the server environment variable
`INTERNAL_PLAN_GRANT_ENABLED` is exactly `true`. It SHALL be off when the variable is absent, and it
MUST be off whenever `VERCEL_ENV` is `production`, whatever the variable says. Any value other than
`true` or `false` SHALL be treated as `false` and MUST NOT stop the application. While it is on,
`standard` SHALL be available to every owner without payment, and the entitlement it grants SHALL
have `source` `internal`. The grant MUST NOT create or modify any order or payment record.

#### Scenario: Grant on outside Production

- **WHEN** `INTERNAL_PLAN_GRANT_ENABLED` is `true`, `VERCEL_ENV` is `preview`, and an owner first
  publishes on plan `standard`
- **THEN** the gift is published with an entitlement of `planId` `standard` and `source` `internal`

#### Scenario: Production never grants it

- **WHEN** `INTERNAL_PLAN_GRANT_ENABLED` is `true` and `VERCEL_ENV` is `production`
- **THEN** plan `standard` is not available, and a publish on it is refused with `details.reason`
  `PLAN_NOT_AVAILABLE`

#### Scenario: Malformed value

- **WHEN** `INTERNAL_PLAN_GRANT_ENABLED` is `yes`
- **THEN** the grant is off and the application keeps serving requests

### Requirement: Entitlement expiry

A published gift's share link SHALL stop working when the server time reaches the gift's
`expiresAt` (`public-gift-viewer` "Share link access"). The comparison SHALL use server time on
every request. Neither the recipient's clock nor any background job SHALL decide it, so a delayed
job never extends access. An expired gift SHALL keep its content, publications and assets; deleting
them is retention work outside this capability. The owner SHALL still be able to open and edit the
working copy of an expired gift, but SHALL NOT publish an update of it (`gift-publishing`
"Pre-publish checks").

#### Scenario: Free link expires after 14 days

- **WHEN** a Free gift granted at `2026-10-08T10:00:00Z` is requested at `2026-10-22T10:00:00Z`
- **THEN** the share link answers as not found

#### Scenario: Last moment before expiry

- **WHEN** the same gift is requested at `2026-10-22T09:59:59Z`
- **THEN** the share link is live
