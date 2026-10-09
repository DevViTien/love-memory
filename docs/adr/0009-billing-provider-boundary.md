# ADR-0009: Put payment behind a billing provider boundary

- Status: accepted; provider onboarding deferred to the paid-MVP sprint
- Date: 2026-09-15

## Context

Payment correctness is a business invariant. Browser return URLs can be replayed and provider
callbacks can arrive late, duplicated or out of order. Directly coupling gift publication to one
payment SDK would make recovery and testing fragile.

## Decision

Define a `BillingProvider` port around checkout creation, webhook verification, provider lookup and
optional cancellation. payOS is the first Vietnamese-market candidate, but it is not installed
until commercial onboarding is confirmed. Only a verified webhook or server reconciliation can
transition an internal order to paid.

Order fulfillment is idempotent and uses an outbox. Amount, currency, owner, gift and price snapshot
are checked against the internal order before entitlement is granted.

## Consequences

- The return URL remains UX-only.
- Raw request bytes must be retained long enough for signature verification but not logged.
- Duplicate provider events map to one internal event/idempotency key.
- Provider credentials are unnecessary for Sprint 1.

## Amendment (2026-10-10, `add-payos-checkout`)

- **The port.** `BillingProvider` (`apps/web/src/modules/billing`) has three operations: create a
  payment link, read its status, cancel it. Webhook verification arrives with the fulfillment
  change.
- **payOS without its SDK.** The adapter is first party and uses `fetch` only. Its signing rules
  (the create-request signature, and the sorted `key=value` signature of `data`) are pinned by
  test vectors computed with `@payos/node` 2.0.5. Every answer is accepted only with code `00` and
  a valid signature under a constant-time comparison.
- **A fake provider** keeps its links in memory and serves its own checkout page. It is refused on
  every Vercel deployment, like the local storage driver.
- **Orders** hold the price snapshot (plan version, amount, currency) and the revision checked at
  checkout. A gift has at most one `pending` order. A checkout key is idempotent per owner.
- **Closing orders.** The order endpoint may close a `pending` order as `cancelled` or `expired`
  from the provider's verified status. Nothing in this change can make an order `paid`.

## Revisit when

- The first payment provider is contractually selected.
- Refund, invoicing or marketplace settlement requirements change the boundary.
