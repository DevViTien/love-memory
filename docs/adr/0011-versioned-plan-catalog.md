# ADR-0011: Plans are versioned code constants snapshotted into gifts

- Status: accepted
- Date: 2026-10-08

## Context

Sprint 5 (plan.md §14.1) needs a pricing and entitlement domain. The server must be the only source
of what a gift may do: maximum photos, watermark, how long its link stays open, and, once Sprint 4
specifies them, password and scheduled access. The Product Owner fixed two plans on 2026-10-08:

- Free: 3 photos, a watermark, 14 days;
- Standard: 49.000đ, the template's photo limit, no watermark, 1 year.

Prices are hypotheses (idea.md §12.2) that will be tested and changed. A gift's limits must not
move when the price list does, and an order must be interpreted with the price it was sold at
(tech-stack.md §11.3, [ADR-0009](./0009-billing-provider-boundary.md)).

## Decision

- **The catalog.** Plans live in `packages/domain/src/billing/plan.ts` as a frozen, versioned
  catalog (`PLAN_CATALOG`). Each entry is one released `{ planId, planVersion }` with its price
  and capabilities. A released version never changes. A new price or limit is a new version, and
  `currentPlan(planId)` offers the highest version for new publishes.
- **The snapshot.** A gift's first publish copies the current version's values into the gift's
  `entitlement` snapshot (with the grant source and time) and sets `expiresAt`. Every later check
  of that gift reads the snapshot, never the catalog. The checkout change gives orders their own
  price snapshot in the same way.
- **No collection, no admin edit.** A price change is a reviewed code change with a test that pins
  the released versions.

## Consequences

- Changing a price or limit needs a deploy. This is acceptable for an MVP with two plans and no
  price experiments yet.
- Gifts and orders can always be explained from their own documents. Removing or editing a
  catalog entry cannot change a granted gift.
- The schema migration for gifts published before plans existed pins the `standard@1` values it
  wrote (`LEGACY_ENTITLEMENT`), with a test that ties them to the catalog.
- The Studio never holds plan constants: the page renders the server's offers into it.

## Revisit when

- Prices are experimented with per segment, or marketing needs to change them without a deploy.
- Partner plans, coupons or subscriptions (plan.md §17.6 P1–P2) need per-account terms.
