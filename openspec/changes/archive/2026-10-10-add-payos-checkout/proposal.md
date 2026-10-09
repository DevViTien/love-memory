# Add payOS checkout

## Why

The Standard plan (49.000đ per gift, `gift-plans`) can only be granted today by the internal
paid-plan grant, which Production forces off. Plan.md §14.2 asks for orders, a billing provider
boundary (ADR-0009), a payOS adapter, checkout creation and return and cancel pages that never
trust the browser. This is Sprint 5 change 4 ([sprint-5-plan.md](../../../docs/sprints/sprint-5-plan.md)).
PO decision S4 applies:

- payOS credentials do not exist yet;
- a fake provider serves development and E2E;
- the payOS adapter is first party (`fetch`, no SDK), with signing rules pinned by test vectors from
  `@payos/node` 2.0.5.

## What Changes

- **Orders** (new `orders` collection, schema version `17`).
  - An order snapshots the gift, its owner, the plan version, the amount in VND and the revision
    being bought.
  - Its states are `pending`, `paid`, `fulfilled`, `cancelled`, `expired`, `failed` and `refunded`,
    with a transition table in the domain. This change writes `pending`, `failed`, `cancelled` and
    `expired`. Only the webhook change may write `paid`, `fulfilled` or `refunded`.
- **Billing provider port** (`BillingProvider`): create a payment link, read its status, cancel it.
  - **The payOS adapter** signs requests and verifies every response signature.
  - **The fake provider** keeps its links in memory, serves its own checkout page, and is refused on
    every Vercel deployment.
  - **Selection** is by `BILLING_PROVIDER` (`payos`, `fake`, or unset for no checkout).
- **Checkout.** `POST /api/gifts/{publicId}/checkout` runs the same checks as a first publish.
  - **Order.** It records a `pending` order and returns the provider's checkout URL.
  - **Idempotency.** Keys live in a per-owner namespace.
  - **Supersession.** A new checkout cancels the gift's older pending order.
  - **No grant.** It never grants an entitlement or publishes anything.
- **Order status.** `GET /api/orders/{orderId}` is for the owner only.
  - It reconciles a `pending` order with the provider's verified status, but only to `cancelled` or
    `expired`.
  - The return and cancel pages (`/checkout/return`, `/checkout/cancel`) poll it. They never trust
    query parameters.
- **Plan availability** (`gift-plans`). When a billing provider is configured, `standard` is
  available through checkout. Otherwise it is available through the internal paid-plan grant, as
  before.
  - **Direct publish refused.** A direct publish of a checkout plan answers `PAYMENT_REQUIRED`.
  - **Internal grant.** It stays until the webhook change can complete a payment, which keeps the
    Standard journeys working in between.
- **Studio.** A checkout plan shows its price.
  - **Confirmation.** It shows the amount, and confirming leads to the provider's checkout page.
  - **Provider down.** When the provider is unreachable, a Vietnamese message says so.
- **Rate limits** `gift-checkout` and `order-read`; the nonce CSP for `/checkout` and `/billing`.

## Capabilities

### New Capabilities

- `billing-checkout`: orders, the billing provider boundary and its adapters, the checkout and order
  endpoints, and the return and cancel pages.

### Modified Capabilities

- `gift-plans`: "Plan availability", where checkout makes `standard` available.
- `gift-publishing`: "Pre-publish checks", where a checkout plan answers `PAYMENT_REQUIRED`.
- `studio-editor`: "Studio preview and publish steps", where the Studio starts a checkout for a
  checkout plan.
- `mutation-request-guards`: "Distributed mutation rate limits", with `gift-checkout` and
  `order-read`.
- `content-security-policy`: "Route-based policy mode selection", with nonce mode for `/checkout`
  and `/billing`.
- `database-schema-management`: the `orders` collection, its validator and indexes, the new rate
  limit scopes, and schema version `17`.

## Non-goals

These belong to `add-payment-webhook-fulfillment`:

- moving an order to `paid`, granting the entitlement and publishing;
- the webhook and `payment.reconcile`;
- the "payment received" email;
- the fake provider's pay action;
- removing the internal paid-plan grant.

Also out of scope:

- refunds;
- invoices;
- the support or admin order view, which comes with the webhook change.

## Impact

- **Code:**
  - `packages/domain` (order states);
  - `packages/contracts` (order DTOs, `checkout` on plan offers);
  - `packages/database` (`orders`, version `17`);
  - `modules/billing` (new);
  - `modules/gifts` (a shared check and the `checkout` plan grant);
  - the Studio publish step;
  - new routes and pages.
- **Configuration:** `BILLING_PROVIDER`, plus `PAYOS_CLIENT_ID`, `PAYOS_API_KEY` and
  `PAYOS_CHECKSUM_KEY` for payOS.
- **Operations:** `db:migrate` to version `17` on each tier, before the build that writes orders.
- **Invariants:**
  - Only a verified webhook or reconciliation will mark an order paid. This change has neither path
    to `paid`.
  - Order access is filtered by owner; a non-owner gets an opaque `404`.
  - Provider credentials, signed payloads and checkout URLs are never logged.
