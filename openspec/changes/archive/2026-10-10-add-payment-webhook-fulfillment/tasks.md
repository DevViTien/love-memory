# Tasks: add-payment-webhook-fulfillment

## 1. Domain and schema

- [x] 1.1 The entitlement source `order`, `planVersionOf`, and the optional order fields `paidAt`,
      `fulfilledAt` and `paymentReference`.
- [x] 1.2 Schema version `18`: `paymentAttempts` (validator and index), the entitlement source
      `order`, and the new order fields. `enqueueJob` gains an optional `availableAt`.

## 2. Payments

- [x] 2.1 `payments.ts`: `recordVerifiedPayment` (wakes jobs when applied, reports mismatches and
      unknown orders), the `publish.finalize.v1` and `payment.reconcile.v1` handlers.
- [x] 2.2 `mongoPaymentRepository.apply`: one transaction with the amount and currency check, the
      move to `paid`, the finalize and email jobs, and the record keyed `{provider}:{reference}`.
- [x] 2.3 Reconciliation shared by the order endpoint and the job. Each checkout enqueues the
      reconcile job, due 2 minutes after its link expires.
- [x] 2.4 The payOS webhook endpoint: raw body capped at 16 KiB, signature over `data`, `401`,
      `200` and `500` answers.
- [x] 2.5 The fake provider's `Thanh toán thử` action and button.

## 3. Fulfillment and plans

- [x] 3.1 The paid-order grant in `checkPublishable` (exact plan version, source `order`), and
      `finalizePaidOrder`. The publish transaction fulfills the order.
- [x] 3.2 The internal paid-plan grant is removed from configuration, policy, offers and the
      Studio. The paid plan is offered as `prepaid` with its note.
- [x] 3.3 The `payment_received` email kind.

## 4. Support

- [x] 4.1 `/admin/orders`: lookup by order id, code or gift, recorded payments without
      references, audited `admin.order.looked_up`, and a navigation link.

## 5. Tests

- [x] 5.1 Unit tests: the payment service and job handlers; the payment and order repositories;
      the webhook (valid, forged, malformed, oversized, non-`00`, unconfigured, failing); the fake
      actions; order lookup; the gift service paid-order grant and `finalizePaidOrder`; and the
      publish fulfillment write, plan offers, the Studio prepaid note, job registration,
      migrations and the email kind.
- [x] 5.2 E2E: Playwright runs with `BILLING_PROVIDER=fake`. The 8-photo journey pays on the fake
      checkout page and reaches `Món quà đã được xuất bản` and the published Studio. A replayed
      checkout key answers `409`, and the order is `fulfilled`.

## 6. Documentation

- [x] 6.1 The payments runbook (flow, configuration including Trigger.dev, webhook registration,
      triage).
- [x] 6.2 The deployment runbook (schema version `18`, the grant removed, billing variables in
      Trigger.dev).
- [x] 6.3 Credential rotation, background jobs, architecture and `.env.example`.

## Out of scope

- Refunds and invoices.
- A real payOS smoke test, which needs credentials (PO decision S4).
- The retention period of orders and payment records, an open PO decision.
