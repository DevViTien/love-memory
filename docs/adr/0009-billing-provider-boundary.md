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

## Revisit when

- The first payment provider is contractually selected.
- Refund, invoicing or marketplace settlement requirements change the boundary.
