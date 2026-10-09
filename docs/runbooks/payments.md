# Payments runbook

Checkout for the Standard plan goes through a billing provider. The behavior is specified in
`openspec/specs/billing-checkout`; the boundary is described in
[ADR-0009](../adr/0009-billing-provider-boundary.md). Owner: Tech Lead.

## How a payment becomes a published gift

1. **Checkout.** `POST /api/gifts/{publicId}/checkout` opens a `pending` order (schema version
   `17`) and a payment link. In the same transaction it enqueues `payment.reconcile.v1`, due 2
   minutes after the link expires.
2. **Payment.** The provider tells us the payment succeeded through one of these. Each is recorded
   once per provider reference in `paymentAttempts` (schema version `18`):
   - the verified webhook `POST /api/billing/webhooks/payos`;
   - a reconciliation that read the provider's verified status (the return page's poll, or
     `payment.reconcile.v1`);
   - for the fake provider, its own `Thanh toán thử` button.
3. **`paid`.** A payment of exactly the order's amount in `VND` makes the order `paid`. In the same
   transaction it enqueues `publish.finalize.v1` and the `payment_received` email.
4. **`fulfilled`.** `publish.finalize.v1` publishes the gift's current revision as its owner, with
   an entitlement of `source` `order`. The publish transaction marks the order `fulfilled`.
5. **The browser only watches.** The return and cancel pages poll the order; they never decide.

## Configuration

| Variable             | Values                                | Where                                                                                                            |
| -------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `BILLING_PROVIDER`   | unset (checkout off), `fake`, `payos` | Each Vercel tier **and its Trigger.dev environment** (reconciliation runs there); `fake` only locally and in E2E |
| `PAYOS_CLIENT_ID`    | payOS channel client id               | Vercel and Trigger.dev, per tier (Production: its own channel)                                                   |
| `PAYOS_API_KEY`      | payOS channel API key (secret)        | Vercel and Trigger.dev, per tier                                                                                 |
| `PAYOS_CHECKSUM_KEY` | payOS channel checksum key (secret)   | Vercel and Trigger.dev, per tier; it signs requests and verifies responses and webhooks                          |

Checkout turns itself off when the configuration is incomplete:

- `payos` without all three credentials;
- `fake` on any Vercel deployment;
- an unknown value.

Pages keep working, and Standard is then unavailable.

**No internal grant.** The internal paid-plan grant is removed. A tier without a provider offers
Free only. Delete `INTERNAL_PLAN_GRANT_ENABLED` from every tier.

**The fake provider** keeps its payment links in the server's memory: a restart forgets them. Its
page `/billing/fake-checkout/{paymentId}` offers `Thanh toán thử` and `Huỷ thanh toán`.

## Enabling payOS on a tier (once credentials exist)

1. Create a payOS payment channel for the tier. Set its client id, API key and checksum key, and
   `BILLING_PROVIDER=payos`, in the Vercel branch variables and in the tier's Trigger.dev
   environment.
2. Make sure `db:migrate` has brought the tier to schema version `18`. Then redeploy from the
   branch, and run `pnpm jobs:deploy`.
3. In the payOS channel, register the webhook URL `{APP_URL}/api/billing/webhooks/payos`. payOS
   sends a signed test notification, which the endpoint acknowledges.
4. Smoke test on `stg`:
   1. pay 49.000đ for an 8-photo draft;
   2. the return page shows `Món quà đã được xuất bản`;
   3. `/admin/orders` shows the order `fulfilled` with its payment `Đã ghi nhận`;
   4. cancel a second checkout, and the cancel page shows `Thanh toán đã huỷ`.
5. Production only after the `stg` smoke test, with the Product Owner's go-ahead.

## Triage

Look orders up in `/admin/orders`, by order code, order id or gift public id. Every search is
audited.

- **`Chưa kết nối được cổng thanh toán`** (`503` `PAYMENT_PROVIDER_UNAVAILABLE`). The provider
  refused or timed out after 10 seconds, or its answer failed signature verification.
  - Check the credentials, the checksum key (a wrong key fails every signature), and payOS status.
- **Webhook answers `401`.** The checksum key differs from the channel's, or someone is forging
  calls. Nothing was recorded. Reconciliation still applies real payments once the link expires.
- **`billing.payment.amount_mismatch` or `billing.payment.unknown_order`** in the logs. Money arrived
  that matches no order, or does not match the order's amount. The order was not changed. Refund
  through the payOS dashboard, or contact the owner.
- **Order `paid` but not `fulfilled`.** `pnpm jobs:dead` shows a `publish.finalize.v1` job with
  `FINALIZE_<reason>`, such as `FINALIZE_INVALID_CONTENT`.
  - The gift could not be published as it is, for example because a photo failed.
  - The owner sees `Đã thanh toán. Bấm Xuất bản để hoàn tất.` in the Studio and can publish without
    paying again.
  - Once the cause is fixed, `pnpm jobs:retry <jobId>` also works.
- **Order still `pending` after its link expired.** `payment.reconcile.v1` retries while the
  provider cannot be read. Check `pnpm jobs:dead`.
- **Never set `paid` or `fulfilled` by hand.** Only a verified payment or the publish may.

Never log or paste provider credentials, signatures, webhook bodies or checkout URLs.
