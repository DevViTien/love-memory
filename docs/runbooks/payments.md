# Payments runbook

Checkout for the Standard plan goes through a billing provider. The behavior is specified in
`openspec/specs/billing-checkout`; the boundary is described in
[ADR-0009](../adr/0009-billing-provider-boundary.md). Owner: Tech Lead.

## What exists today

| Piece                                  | State                                                                                                                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orders (`orders`, schema version `17`) | Created by `POST /api/gifts/{publicId}/checkout`. Their states are `pending`, `paid`, `fulfilled`, `cancelled`, `expired`, `failed` and `refunded`.                                                                     |
| Provider status                        | Read by the order endpoint for `pending` orders. It closes them as `cancelled` or `expired`.                                                                                                                            |
| `paid` and fulfillment                 | **Not yet.** The verified webhook, `payment.reconcile` and `publish.finalize` come with `add-payment-webhook-fulfillment`. Until then a paid order stays `pending`; do not enable a real provider on a tier owners use. |
| The internal paid-plan grant           | Used only while no provider is configured. It is removed with the webhook change.                                                                                                                                       |

## Configuration

| Variable             | Values                                | Where                                                      |
| -------------------- | ------------------------------------- | ---------------------------------------------------------- |
| `BILLING_PROVIDER`   | unset (checkout off), `fake`, `payos` | Each Vercel tier; `fake` only locally and in E2E           |
| `PAYOS_CLIENT_ID`    | payOS channel client id               | Vercel, per tier (Production: its own channel)             |
| `PAYOS_API_KEY`      | payOS channel API key (secret)        | Vercel, per tier                                           |
| `PAYOS_CHECKSUM_KEY` | payOS channel checksum key (secret)   | Vercel, per tier; it signs requests and verifies responses |

Checkout turns itself off when the configuration is incomplete:

- `payos` without all three credentials;
- `fake` on any Vercel deployment;
- an unknown value.

Pages keep working, and Standard falls back to the internal grant where that is on.

**The fake provider** keeps its payment links in the server's memory: a restart forgets them. Its
page `/billing/fake-checkout/{paymentId}` offers `Huỷ thanh toán` only. The pay action arrives with
the webhook change.

## Enabling payOS on `stg` (once credentials exist)

1. Create a payOS payment channel for staging. Copy its client id, API key and checksum key into
   the `stg` Preview branch variables, and set `BILLING_PROVIDER=payos`.
2. Make sure `db:migrate` has brought the tier to schema version `17`. Then redeploy from `stg`.
3. Smoke test:
   1. publish an 8-photo draft on `Tiêu chuẩn`;
   2. check that the payOS page opens;
   3. cancel there;
   4. check that `/checkout/cancel?order=…` shows `Thanh toán đã huỷ`.
4. Leave Production unset until the webhook change is deployed and verified on `stg`.

## Triage

- **`Chưa kết nối được cổng thanh toán`** (`503` `PAYMENT_PROVIDER_UNAVAILABLE`). The provider
  refused or timed out after 10 seconds, or its answer failed signature verification.
  - Logs show `billing.create-payment-link` with the error name only.
  - Check the credentials, the checksum key (a wrong key fails every signature), and payOS status.
- **An order stuck in `pending`.** The provider was unreachable when the owner checked, or the
  payment succeeded but fulfillment does not exist yet (see above).
  - Look the order up by `_id` or `orderCode` in `orders`.
  - Never set `paid` by hand: only a verified notification or reconciliation may.

Never log or paste provider credentials, request signatures or checkout URLs.
