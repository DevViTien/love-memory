# Tasks: add-payos-checkout

## 1. Domain, contracts and schema

- [x] 1.1 `packages/domain` `billing/order.ts`: the order statuses and their transition table,
      providers, the order schema, 12-digit order codes, `orderDescription`, the 15-minute checkout
      TTL.
- [x] 1.2 `packages/contracts` `billing.ts`: the checkout request, the order DTO and its response,
      and `checkout` on `PlanOfferDto`.
- [x] 1.3 `packages/database`, schema version `17`: `orders`, with its validator and four indexes
      (unique order code, one pending order per gift, per-owner idempotency keys, owner and
      creation time), and the scopes `gift-checkout` and `order-read`.

## 2. Billing module

- [x] 2.1 `config/billing.ts`: `BILLING_PROVIDER` (`payos`, `fake` or off) and the payOS
      credentials. `fake` is refused on Vercel, and the parser never throws.
- [x] 2.2 `BillingProvider` port: create, read, cancel, and `BillingProviderError`.
- [x] 2.3 The payOS adapter (`fetch`, headers, 10-second timeout, signed requests, verified
      answers). Signing rules are pinned by `@payos/node` 2.0.5 vectors.
- [x] 2.4 The fake provider, in memory and process-wide, with its checkout page and its cancel
      action, both not-found unless configured.
- [x] 2.5 The checkout service: shared first-publish checks, one pending order per gift with
      best-effort cancellation of superseded links, and per-owner idempotency. A provider failure
      marks the order `failed` and releases its key. Order reads are owner-only, and reconcile a
      pending order to `cancelled` or `expired`.
- [x] 2.6 The Mongo order repository.

## 3. Gifts and plans

- [x] 3.1 `PlanGrant` `checkout`. `checkPublishable` is shared by publish and checkout. Publish
      answers `PAYMENT_REQUIRED`; checkout answers `NO_PAYMENT_REQUIRED`.
- [x] 3.2 `planGrantPolicy` precedence: checkout, then the internal grant, then unavailable. Plan
      offers carry `checkout`.

## 4. Routes and pages

- [x] 4.1 `POST /api/gifts/{publicId}/checkout` and `GET /api/orders/{orderId}`, with rate limits
      and an opaque `404` for a non-owner.
- [x] 4.2 `/checkout/return` and `/checkout/cancel` (nonce CSP, server-rendered first state,
      polling, no trust in query parameters).
- [x] 4.3 Nonce CSP for `/checkout` and `/billing/`.
- [x] 4.4 Studio: the checkout note on the plan, the amount and `Thanh toán {price}` in the
      confirmation, checkout instead of publish followed by navigation to the provider, and the
      `PAYMENT_PROVIDER_UNAVAILABLE` message.

## 5. Tests

- [x] 5.1 Unit and component tests: domain, contracts, configuration, signatures, the payOS and
      fake providers, the checkout service, the repository, the routes, the fake action, the
      checkout status page, the gift service checks, plan offers, the Studio publish step, the CSP
      modes and migrations.
- [x] 5.2 E2E (`checkout.spec.ts`), with seeded orders: the owner-only order endpoint
      (`no-store`), return and cancel pages that ignore forged parameters, not-found for an unknown
      order, a sign-in prompt and a `404` for another visitor, and the fake checkout page not found
      while no provider is configured.

## 6. Documentation

- [x] 6.1 The payments runbook, the deployment runbook (variables and schema version `17`),
      credential rotation (payOS keys) and `.env.example`.
- [x] 6.2 ADR-0009 amendment, and the architecture section "Billing and checkout".

## Out of scope

- **The webhook change** (`add-payment-webhook-fulfillment`) brings:
  - the verified webhook;
  - the fake pay action;
  - `paid` and fulfillment;
  - `payment.reconcile`;
  - the "payment received" email;
  - the support order view;
  - removal of the internal paid-plan grant;
  - the full Studio-to-published E2E journey.
- Refunds and invoices.
