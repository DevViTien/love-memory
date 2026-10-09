# Add payment webhook and fulfillment

## Why

`add-payos-checkout` can start a payment and follow it, but no payment ever becomes a published
gift. Plan.md §14.2–§14.3 and Gate M4 require several things:

- a verified webhook;
- idempotent event handling;
- amount and currency checks;
- provider reconciliation;
- publish after payment, even when the browser is closed;
- no client-side path to a paid entitlement.

This is Sprint 5 change 5
([sprint-5-plan.md](../../../docs/sprints/sprint-5-plan.md)). It also removes the internal
paid-plan grant, as the plan requires.

## What Changes

- **Webhook.** `POST /api/billing/webhooks/payos` reads the raw body, verifies the payOS signature
  over `data`, and records a successful payment. Invalid signatures answer `401`; recording failures
  answer `500` so that payOS retries.
- **Payment application**, the only path to `paid`. One transaction does all of this:
  - records the payment in `paymentAttempts` (schema version `18`), keyed
    `{provider}:{reference}`, so a duplicate is a no-op;
  - checks the amount and `VND` against the order;
  - moves the order from `pending`, `cancelled` or `expired` to `paid`;
  - enqueues `publish.finalize.v1` and the `payment_received` email.

  Mismatches and unknown orders are recorded and reported for support, never applied.

- **Reconciliation.** Each checkout enqueues `payment.reconcile.v1`, due 2 minutes after its link
  expires. The job and the order status endpoint apply a verified `PAID` status. A lost webhook or a
  closed browser still ends in a published gift.
- **Fulfillment.** `publish.finalize.v1` publishes the gift's current revision as its owner:
  - on the order's exact plan version, with an entitlement of `source` `order`;
  - with the order id as the idempotency key;
  - with the order moving to `fulfilled` in the publish transaction.

  A gift that cannot be published stays `paid`. The owner finishes it in the Studio, which offers
  the paid plan as `Đã thanh toán. Bấm Xuất bản để hoàn tất.`.

- **The fake provider** gains `Thanh toán thử`, which records a verified payment of its amount.
  Playwright now runs with `BILLING_PROVIDER=fake`, and the 8-photo journey pays through it.
- **Support view.** `/admin/orders` looks orders up by code, id or gift, shows their recorded
  payments, and is audited (`admin.order.looked_up`).
- **Removal of the internal paid-plan grant.**
  - `INTERNAL_PLAN_GRANT_ENABLED` and its configuration are deleted.
  - Standard is available only through checkout, or from a paid order.
  - Existing `internal` entitlements are kept.
- **Email** `payment_received` (`system-emails`).

## Capabilities

### New Capabilities

None. The new requirements extend `billing-checkout`.

### Modified Capabilities

- `billing-checkout`:
  - adds "Verified payment webhook", "Payment application", "Payment reconciliation", "Paid order
    fulfillment" and "Admin order lookup";
  - modifies "Orders and their states", "Order status endpoint" and "Fake billing provider".
- `gift-plans`:
  - "Gift entitlement snapshot" gains the source `order`;
  - "Plan availability" offers paid orders and no longer offers the grant;
  - "Internal paid-plan grant" is **REMOVED**.
- `gift-publishing`: "Publish endpoint and authorization", "Pre-publish checks", "Immutable
  publication snapshot" and "Idempotent publish" handle the paid-order grant and order fulfillment.
- `studio-editor`: "Studio preview and publish steps" gains the prepaid note and loses the
  internal-grant note.
- `system-emails`: "System email job" and "Email kinds and content" add `payment_received`.
- `audit-log`: "Audit records" adds `admin.order.looked_up`.
- `database-schema-management`: `paymentAttempts`, the entitlement source `order`, the new order
  fields, and schema version `18`.

## Non-goals

- Refunds and their status writer. `refunded` remains a state no endpoint writes.
- Invoices.
- A real payOS smoke test. It needs credentials (PO decision S4).
- Retention of orders and payment records: an open PO decision, recorded for the end-of-sprint
  summary.

## Impact

- **Code:** `modules/billing` (payments, jobs, webhook, admin lookup), `modules/gifts` (paid-order
  grant, `finalizePaidOrder`, the fulfillment write), the composition, the Studio offers, and the
  fake page.
- **Schema:** version `18`.
- **Operations:**
  - `db:migrate` and `pnpm jobs:deploy` on each tier;
  - billing variables also in Trigger.dev;
  - the webhook URL registered in the payOS channel;
  - `INTERNAL_PLAN_GRANT_ENABLED` deleted.

  A tier without a provider offers Free only.

- **Invariants:**
  - Only a verified webhook or reconciliation marks an order paid (the fake only where no Vercel
    deployment can run it).
  - Publish and payment are idempotent.
  - No payment payload, reference or signature is logged.
