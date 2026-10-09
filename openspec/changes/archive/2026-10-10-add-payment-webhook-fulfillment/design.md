# Design: payment webhook and fulfillment

## Context

- **What exists.** `add-payos-checkout` created orders, the provider port with payOS and fake
  adapters, checkout, and the polling pages. The publish path (`gift-service`
  `checkPublishable` + `publishGift`) grants an entitlement in the publish transaction.
- **Generic jobs** run idempotent handlers from the outbox, inline or on Trigger.dev.

## Decisions

### D1. One entry point to `paid`

`createPaymentService().recordVerifiedPayment(payment)` is the only writer of `paid`. Its callers:

- the webhook, after signature verification;
- reconciliation, after a verified status read;
- the fake's pay action, where no Vercel deployment can run it.

`mongoPaymentRepository.apply` runs one transaction:

1. Find the order by provider and order code.
2. Decide the outcome.
3. For `applied`, update the order, conditional on `pending`, `cancelled` or `expired`, and enqueue
   `publish.finalize.v1` and `payment_received`.
4. Insert the `paymentAttempts` record **last**. Its id is `{provider}:{reference}`, so a duplicate
   key aborts the whole transaction, writes included. The answer is `duplicate`.

**Why a record per reference instead of per order.** Two different payments for one order (a
customer paying twice) are distinct facts. Support needs to see the second one as `already_paid`.

### D2. Accept payments for closed orders

`cancelled` and `expired` orders may still become `paid` (the change-4 transition table). Money
arrived; ignoring it would require a refund for a gift the owner wanted. A superseding checkout of
the same gift leaves two orders: the later payment fulfills, and the other payment is
`already_paid` for support.

### D3. Fulfillment reuses publishing

`giftService.finalizePaidOrder(order)` calls `publishGift` with:

- the owner's id;
- the gift's current revision;
- the order's plan;
- the order id as the idempotency key.

`checkPublishable` looks up the gift's `paid` order (`publishing.paidOrders`). With one on the
requested plan, it grants that exact plan version (`planVersionOf`) with source `order`, and passes
`paidOrderId` to the repository. The repository's publish transaction then updates that order
`paid → fulfilled`, conditional; a miss aborts the publish as stale.

**Exactly once.** Every path (job, Studio, a retry, a parallel run) fulfills the order at most once
and publishes at most once.

**Which revision.** The current revision, not the one recorded at checkout. The owner may keep
editing while paying, and the current content passes every pre-publish check again.

**Outcomes:**

- **Revision conflict:** retryable.
- **A gift that cannot be published:** content, template, deleted or already published. The job
  re-reads the order; if another path fulfilled it, the job is done. Otherwise it dies with
  `FINALIZE_<code>`, so support sees it in `jobs:dead`, and the order stays `paid` for the owner to
  finish in the Studio.

### D4. Reconciliation

- **The job.** `payment.reconcile.v1` is enqueued in the checkout transaction with a delayed
  `availableAt`; `enqueueJob` gains an optional `availableAt`.
- **The status read.** `checkoutService.reconcile(order)` is shared by the order endpoint and the
  job. A full `PAID` status becomes a verified payment with the reference
  `reconciliation:{orderCode}`. A webhook for the same payment later records `already_paid`, which
  is harmless.
- **Still pending.** The job retries `PAYMENT_PENDING` with backoff, within its budget of 6.

### D5. Webhook endpoint

- **Not a browser mutation.** No JSON-origin guard: payOS calls it server to server. Authenticity is
  the signature.
- **The raw body** is read once and capped at 16 KiB.
- **Answers:**
  - `401` for anything unverifiable;
  - `200` for any verified notification, including payOS's registration test and non-`00` codes;
  - `500` only when recording fails, so payOS retries and the duplicate key keeps the retry safe.
- **No rate limit.** Verification is cheap, and limiting payOS's IPs risks dropping real payments.

### D6. Removing the internal grant

- **Code removed:** `PlanGrant` loses the `internal` source, `config/internal-plan-grant.ts` is
  deleted, and `PlanOfferDto` replaces `internalGrant` with `prepaid`.
- **Data kept:** `internal` stays a valid entitlement source for existing gifts (domain and
  validator).
- **Consequence:** a tier without a provider offers Free only. Until payOS credentials exist, Standard
  cannot be tested on `dev`/`stg`; locally and in E2E the fake provider covers it.

### D7. Support view

`/admin/orders` follows the admin gift lookup:

- the same guard;
- audit before data, without the searched text;
- exact identifiers only (order id, 12-digit code, gift public id), at most 20 results.

Payment references stay hidden; the record id holds them.

## Risks

- **A payOS webhook with an unexpected shape** (for example a non-integer `orderCode`) is
  acknowledged without effect. Reconciliation then applies the payment once the link expires.
- **Rolling back** past schema version 18 breaks updates of gifts whose entitlement source is
  `order`. Roll forward instead (deployment runbook).
