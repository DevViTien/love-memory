# Design: payOS checkout

## Context

- **Plans and grants.** Plans, entitlements and the internal paid-plan grant exist (`gift-plans`).
  The publish endpoint grants an entitlement in the same transaction as the first publication.
- **ADR-0009** puts payments behind a `BillingProvider` port. Only a verified webhook or
  reconciliation may mark an order paid.
- **PO decision S4.** There are no payOS credentials. A fake provider serves development and E2E,
  and the payOS adapter is first party (`fetch`), pinned by `@payos/node` 2.0.5 test vectors.
- **The split.** This change is the first half of payment: it can start a payment and follow it.
  `add-payment-webhook-fulfillment` turns a verified payment into a published gift.

## Decisions

### D1. The order is the prepared snapshot

An order records what is bought:

- `giftId` and `giftPublicId`;
- `ownerId`;
- `planId`, `planVersion`, `amountVnd` and `currency`;
- `revision`, the revision the pre-publish checks passed;
- `rightsConfirmedAt`.

The content itself stays in the gift's revisions; fulfillment decides how to publish.

**One pending order per gift.** A partial unique index on `giftId` among `pending` orders enforces
it. A new checkout closes the older pending order as `cancelled` in its transaction, then cancels
that payment link at the provider after the commit (best effort).

- **Why the newer checkout wins:** the owner is acting now, and an abandoned tab must not block
  them.
- **The older link.** If the older link is paid anyway, the transition `cancelled → paid` lets
  fulfillment honor it.

### D2. Per-owner idempotency on the order

Checkout keys live on the order (`ownerId` + `idempotencyKey`, a partial unique index), not in
`idempotencyKeys`. Its unique `{scope, key}` index is global, so the second half of debt D5 is
addressed here, without migrating the shared collection.

- **A replay** returns the pending order and its URL.
- **A different body** answers `409` without details.
- **A provider failure** marks the order `failed` and unsets its key, so the Studio's retry with
  the same key opens a new order.

### D3. The provider call is outside the transaction

The sequence:

1. The order is inserted `pending` with `checkoutUrl: null`.
2. The provider is called.
3. The URL is attached only if the order is still `pending`.

**A crash between 1 and 3** leaves a pending order without a URL. Its replay marks it `failed` and
starts over. No payment can exist for it, because its link was never shown.

### D4. Shared pre-publish checks

`createGiftService` gains `checkPublishable(gift, input, now, purpose)`, which `publishGift` and
the new `checkCheckout` share. Only the plan step differs:

| `PlanGrant` kind | Publish              | Checkout              |
| ---------------- | -------------------- | --------------------- |
| `grant`          | allowed              | `NO_PAYMENT_REQUIRED` |
| `checkout`       | `PAYMENT_REQUIRED`   | allowed               |
| `unavailable`    | `PLAN_NOT_AVAILABLE` | `PLAN_NOT_AVAILABLE`  |

A published gift answers `NO_PAYMENT_REQUIRED`, since updates are free (S3).

### D5. Provider selection and precedence

`config/billing.ts` parses `BILLING_PROVIDER` without ever throwing; plan offers read it on every
render. Precedence for Standard is checkout, then the internal grant, then unavailable.

- **Why checkout first:** on `stg`, a payOS smoke test is possible without turning the grant off.
- **The Playwright server** sets no provider, so the existing Standard journeys keep the internal
  grant. The webhook change switches E2E to the fake provider and removes the grant.

### D6. payOS adapter

**The calls.** `POST /v2/payment-requests`, `GET /v2/payment-requests/{orderCode}` and
`POST /v2/payment-requests/{orderCode}/cancel`.

- **Headers:** `x-client-id` and `x-api-key`.
- **Timeout:** 10 seconds.
- **Description:** `LM {orderCode}` (at most 25 characters, no gift content).
- **Order codes:** 12-digit random integers with a unique index. The driver stores them as
  doubles, which the validator allows.

**Answer checks.** An answer needs:

- code `00`;
- `data`;
- a `signature` equal under `timingSafeEqual` to the HMAC of `data` serialized as the SDK does:
  keys sorted, `null` as empty, arrays as JSON with each element's keys sorted.

Errors carry short reasons only.

### D7. Fake provider

**In memory, process-wide.** The fake provider keeps its links in a `globalThis` map keyed by a
symbol, because Next.js may bundle route handlers and pages separately. Its checkout page and its
action are not-found unless `BILLING_PROVIDER=fake`, which a Vercel deployment refuses. In this
change the page can only cancel.

### D8. Return and cancel pages

- **The server renders the first state.** It calls `getOrder`, which also reconciles.
- **The client then polls** every 3 seconds for at most 3 minutes, while the order is `pending` or
  `paid`.
- **What the pages read.** Only `order` is read from the query. The pages are nonce-CSP routes with
  `connection()` in their layout.
- **Leaving the Studio.** The Studio navigates with `window.location.assign`, which the CSP does not
  restrict.

## Risks

- **A payment that succeeds stays `pending`.** Until the webhook change, it shows
  `Đang chờ xác nhận thanh toán`. This is why no tier may enable a real provider before then (see
  the runbook).
- **Restarts forget fake links.** A restarted development server cannot reconcile them, and orders
  stay `pending`. This is acceptable for development.
