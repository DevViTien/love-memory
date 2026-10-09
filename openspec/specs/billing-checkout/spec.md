# billing-checkout Specification

## Purpose

Lets an owner pay for a paid plan through a billing provider. An order records what is being paid
for, the provider hosts the payment, and the browser never decides whether a payment succeeded.

## Requirements

### Requirement: Billing provider configuration

The server SHALL select the billing provider from `BILLING_PROVIDER`, read on every request:

- **`payos`**: the payOS adapter. It also needs `PAYOS_CLIENT_ID`, `PAYOS_API_KEY` and
  `PAYOS_CHECKSUM_KEY`.
- **`fake`**: the fake provider. It is allowed only when `VERCEL_ENV` is unset, empty or
  `development`.
- **Unset or empty**: no provider, so checkout is off.

Checkout SHALL be off, and the application SHALL keep serving requests, in each of these cases:

- `BILLING_PROVIDER` holds any other value;
- a `payos` credential is missing;
- `fake` is set on a Vercel deployment.

Provider credentials MUST NOT be logged or sent to the browser.

#### Scenario: Fake refused on Vercel

- **WHEN** `BILLING_PROVIDER` is `fake` and `VERCEL_ENV` is `preview`
- **THEN** checkout is off, and plan `standard` is not offered through checkout

#### Scenario: Incomplete payOS configuration

- **WHEN** `BILLING_PROVIDER` is `payos` and `PAYOS_CHECKSUM_KEY` is missing
- **THEN** checkout is off, and pages keep rendering

### Requirement: Orders and their states

An order SHALL be stored in `orders` with:

- `_id` (UUID);
- `orderCode`: a random positive integer of 12 digits, unique, used as the provider's order
  reference;
- `giftId`, `giftPublicId`, `ownerId`;
- `planId`, `planVersion`, `amountVnd` (the plan version's `priceVnd`) and `currency` `VND`;
- `revision`: the gift revision checked at checkout;
- `rightsConfirmedAt`;
- `provider` (`payos` or `fake`), `providerPaymentId` and `checkoutUrl` (both `null` until the
  provider answers);
- `status`, `expiresAt` (the payment link's expiry, 15 minutes after creation), `createdAt` and
  `updatedAt`;
- once paid, `paidAt` and `paymentReference`; once fulfilled, `fulfilledAt`.

The status SHALL follow these transitions and no other:

| From                   | To                                            |
| ---------------------- | --------------------------------------------- |
| `pending`              | `paid`, `cancelled`, `expired`, `failed`      |
| `cancelled`, `expired` | `paid` (a payment verified after the closing) |
| `paid`                 | `fulfilled`, `refunded`                       |
| `fulfilled`            | `refunded`                                    |
| `failed`, `refunded`   | none                                          |

**Writers.**

- **`paid`:** only "Payment application" MAY move an order to `paid`, for a verified provider
  notification, a reconciliation that read the provider's verified status, or the fake provider's
  own confirmation.
- **`fulfilled`:** only the publish that fulfills the order MAY write it.
- **`refunded`:** no endpoint writes it.

A gift SHALL have at most one `pending` order.

#### Scenario: One pending order per gift

- **WHEN** a second checkout of the same gift creates a new order
- **THEN** the earlier `pending` order becomes `cancelled` in the same transaction, and exactly one
  order of the gift is `pending`

### Requirement: Checkout endpoint

`POST /api/gifts/{publicId}/checkout` SHALL apply the mutation guards and limits of the publish
endpoint, in the same order:

- the JSON media type;
- the same-origin checks;
- an `Idempotency-Key` UUID;
- the rate limit scope `gift-checkout`;
- a body of at most 1 KiB, `{ "expectedRevision", "planId", "rightsConfirmed": true }`.

**Pre-checkout checks.** For the signed-in owner, the gift SHALL pass the pre-publish checks of a
first publish (`gift-publishing` "Pre-publish checks"), with the same responses. The status SHALL be
`draft`; a published gift answers `409` `CONFLICT` with `details.reason` `NO_PAYMENT_REQUIRED`. The
plan:

- a plan that does not need payment answers `409` `CONFLICT` with `details.reason`
  `NO_PAYMENT_REQUIRED`;
- an unavailable plan answers `PLAN_NOT_AVAILABLE`.

**On success,** the server SHALL do the following, in this order:

1. **Order transaction.** In one transaction, close any `pending` order of the gift as `cancelled`,
   and insert a `pending` order for the current version of the plan.
2. **Payment link.** Ask the provider for a payment link, with:
   - the order code;
   - the amount;
   - the description `LM {orderCode}`;
   - the return URL `{APP_URL}/checkout/return?order={orderId}` and the cancel URL
     `{APP_URL}/checkout/cancel?order={orderId}`;
   - the order's `expiresAt`.
3. **Response.** Store the provider's payment id and checkout URL on the order, and answer `201`
   with `data.order` (see "Order status endpoint").
4. **Cleanup.** Ask the provider to cancel the links of the orders it closed. This is best effort:
   a failure is reported, and never changes the response.

**Provider failure.** When the provider refuses or cannot be reached, the order SHALL become
`failed`, release its idempotency key, and the response SHALL be `503` `SERVICE_UNAVAILABLE` with
`details.reason` `PAYMENT_PROVIDER_UNAVAILABLE`.

**Idempotency.** It is namespaced per owner. The same owner, key and request SHALL answer `201`
with the same order while it is `pending` with a checkout URL. The same key with a different
request, or for an order that is no longer `pending`, SHALL answer `409` `CONFLICT` without
details. A `pending` order that never received a checkout URL (its request ended before the
provider answered) SHALL become `failed`, and the request SHALL proceed as a new checkout.

The endpoint SHALL NOT change the gift, grant an entitlement or publish anything.

#### Scenario: Checkout for Standard

- **WHEN** the owner of a complete 8-photo draft at revision `5` sends a checkout for `standard`
  while the fake provider is configured
- **THEN** the response is `201` with `data.order` holding `status` `pending`, `amountVnd` `49000`,
  `currency` `VND` and a `checkoutUrl`
- **AND** the stored order has `revision` `5`, and the gift is still a `draft`

#### Scenario: Free needs no checkout

- **WHEN** the owner sends a checkout for `free`
- **THEN** the response is `409` with `details.reason` `NO_PAYMENT_REQUIRED`, and no order exists

#### Scenario: Provider unreachable

- **WHEN** the provider fails to create the payment link
- **THEN** the response is `503` with `details.reason` `PAYMENT_PROVIDER_UNAVAILABLE`, the order is
  `failed`, and a retry with the same key creates a new order

#### Scenario: Replayed checkout

- **WHEN** the same owner repeats a successful checkout with the same key and body
- **THEN** the response is `201` with the same `orderId` and `checkoutUrl`

### Requirement: Order status endpoint

`GET /api/orders/{orderId}` SHALL answer only the order's owner. An unknown order, an order of
another owner, and a request without a session all answer `404` `NOT_FOUND`. Requests count against
the rate limit scope `order-read`.

**The response** is `200` with `Cache-Control: no-store` and `data.order` holding exactly:

- `orderId`, `status`, `planId`, `amountVnd`, `currency` and `giftPublicId`;
- `checkoutUrl`, while the order is `pending`, otherwise `null`;
- `expiresAt` and `createdAt` (ISO 8601).

**Reconciliation.** Before answering for a `pending` order, the server SHALL reconcile it with the
provider's verified status ("Payment reconciliation"):

- `PAID` applies the payment;
- `CANCELLED` makes the order `cancelled`;
- `EXPIRED` makes the order `expired`;
- any other status, or a provider failure, leaves the order unchanged.

#### Scenario: Owner reads a cancelled checkout

- **WHEN** the provider reports the payment link `CANCELLED` and the owner reads the order
- **THEN** the order is `cancelled`, and the response holds `status` `cancelled` and `checkoutUrl`
  `null`

#### Scenario: Another account

- **WHEN** a signed-in user who does not own the order reads it
- **THEN** the response is `404`

#### Scenario: Paid at the provider

- **WHEN** the provider reports `PAID` in full for a `pending` order
- **THEN** the payment is applied, and the response holds `status` `paid`, or `fulfilled` once
  fulfillment ran

### Requirement: Return and cancel pages

`/checkout/return?order={orderId}` and `/checkout/cancel?order={orderId}` SHALL:

- render for the signed-in owner, with the nonce CSP;
- show a sign-in link for a visitor without a session;
- show `Không tìm thấy đơn thanh toán này.` for any other order.

**Polling.** They SHALL poll the order status endpoint every 3 seconds while the order is
`pending`, for at most 3 minutes, and show:

| Status      | Heading                          |
| ----------- | -------------------------------- |
| `pending`   | `Đang chờ xác nhận thanh toán`   |
| `paid`      | `Đã nhận thanh toán`             |
| `fulfilled` | `Món quà đã được xuất bản`       |
| `cancelled` | `Thanh toán đã huỷ`              |
| `expired`   | `Phiên thanh toán đã hết hạn`    |
| `failed`    | `Chưa tạo được phiên thanh toán` |
| `refunded`  | `Thanh toán đã được hoàn tiền`   |

**Links.**

- Every state links to the gift's Studio page with `Về trang món quà`.
- A `pending` order with a checkout URL also links to it with `Tiếp tục thanh toán`.
- After 3 minutes of `pending`, the page stops polling and says
  `Chưa nhận được xác nhận. Hãy tải lại trang sau ít phút.`

**What the pages trust.** They MUST NOT read the provider's query parameters to decide any status.

#### Scenario: Return before confirmation

- **WHEN** the owner reaches the return page of a `pending` order
- **THEN** the heading `Đang chờ xác nhận thanh toán` shows, and the page keeps polling

#### Scenario: Forged return parameters

- **WHEN** the return page is opened with `?order={orderId}&status=PAID&code=00` for a `pending`
  order
- **THEN** the page still shows `Đang chờ xác nhận thanh toán`

### Requirement: payOS adapter

The payOS adapter SHALL call `https://api-merchant.payos.vn` with the headers `x-client-id` and
`x-api-key`, and a 10-second timeout per request. It SHALL implement:

- **create:** `POST /v2/payment-requests` with `orderCode`, `amount`, `description`, `cancelUrl`,
  `returnUrl`, `expiredAt` (Unix seconds), one item, and `signature`. The signature is the
  lowercase hex HMAC-SHA256, keyed by the checksum key, of
  `amount={amount}&cancelUrl={cancelUrl}&description={description}&orderCode={orderCode}&returnUrl={returnUrl}`.
- **read:** `GET /v2/payment-requests/{orderCode}`.
- **cancel:** `POST /v2/payment-requests/{orderCode}/cancel`.

**Response checks.** A response SHALL be accepted only when all of these hold:

- its `code` is `00`;
- it has `data`;
- its `signature` equals, under a constant-time comparison, the HMAC-SHA256 of `data` serialized as
  `@payos/node` 2.0.5 does:
  - keys sorted;
  - `key=value` pairs joined by `&`;
  - `null` written as an empty string;
  - arrays written as JSON, with each element's keys sorted.

Anything else is a provider failure. Test vectors computed with `@payos/node` 2.0.5 SHALL pin both
signatures.

#### Scenario: Tampered response

- **WHEN** a payOS response's `data.checkoutUrl` was changed after signing
- **THEN** the adapter rejects it, and checkout answers `PAYMENT_PROVIDER_UNAVAILABLE`

### Requirement: Fake billing provider

**The links.** The fake provider SHALL keep its payment links in the server's memory, each with:

- the status `PENDING`;
- the amount, the description, and the return and cancel URLs;
- the checkout URL `{APP_URL}/billing/fake-checkout/{paymentId}`.

**The checkout page** SHALL show the amount and two buttons, which act through
`POST /api/billing/fake/{paymentId}`:

- **`Thanh toán thử`** marks the link `PAID` and records a verified payment of its amount (source
  `fake`, reference `fake:{paymentId}`), then opens the return URL;
- **`Huỷ thanh toán`** marks the link `CANCELLED`, then opens the cancel URL.

**When it is off.** The page and that endpoint SHALL answer not-found unless the fake provider is
the configured provider.

#### Scenario: Cancel at the fake provider

- **WHEN** the owner presses `Huỷ thanh toán` on the fake checkout page
- **THEN** the browser reaches `/checkout/cancel?order={orderId}`, and the page shows
  `Thanh toán đã huỷ`

#### Scenario: Pay at the fake provider

- **WHEN** the owner of a complete 8-photo draft confirms `Thanh toán 49.000đ`, then presses
  `Thanh toán thử`
- **THEN** the return page shows `Món quà đã được xuất bản`, and the Studio shows the published
  gift on `Tiêu chuẩn`

### Requirement: Verified payment webhook

`POST /api/billing/webhooks/payos` SHALL accept payOS payment notifications only while payOS is the
configured provider; otherwise it answers `404`.

**Verification.** It SHALL read the raw body once, refuse a body larger than 16 KiB, and accept the
notification only when `signature` equals the payOS signature of its `data` (`billing-checkout`
"payOS adapter"). An invalid signature, malformed JSON or a missing field SHALL answer `401`
`UNAUTHORIZED` and record nothing. The body, the signature and the provider's reference MUST NOT
be logged.

**Effect.** A verified notification whose `data.code` is `00` SHALL be recorded as a verified
payment (see "Payment application"):

- the amount `data.amount`;
- the currency `data.currency` (default `VND`);
- the order code `data.orderCode`;
- the reference `data.reference`;
- the source `webhook`.

Any other verified notification, including payOS's test of the URL, SHALL be acknowledged without
effect.

**Answers.** A verified notification SHALL be answered `200` with `{ "success": true }`. A failure
while recording SHALL answer `500`, so that payOS delivers it again.

#### Scenario: Webhook invalid signature

- **WHEN** a notification arrives whose `data.amount` was changed after signing
- **THEN** the response is `401`, and no payment is recorded

#### Scenario: Paid webhook

- **WHEN** a verified notification with code `00`, the order's amount and its order code arrives
- **THEN** the response is `200`, and the order becomes `paid`

### Requirement: Payment application

A verified payment SHALL be applied in one database transaction:

1. **The order.** Find the order with the payment's provider and order code.
2. **The outcome.**
   - **`unknown_order`:** no such order exists.
   - **`amount_mismatch`:** the amount differs from the order's `amountVnd`, or the currency is not
     `VND`. The order is unchanged.
   - **`applied`:** the order is `pending`, `cancelled` or `expired`. It becomes `paid`, with
     `paidAt` and `paymentReference`. The same transaction enqueues `publish.finalize.v1`
     (`{ orderId }`) and the `payment_received` email (`system-emails`).
   - **`already_paid`:** any other status.
3. **The record.** Insert one record into `paymentAttempts`. Its id is `{provider}:{reference}`, and
   it holds the order code, the order id or `null`, the amount, the currency, the outcome, the
   source (`webhook`, `reconciliation` or `fake`) and the time.

**Duplicates.** A payment whose `{provider}:{reference}` was recorded before SHALL change nothing,
not even the record (`duplicate`).

**Support.** The outcomes `amount_mismatch` and `unknown_order` SHALL be reported to operations for
support, with the outcome only.

**Waking the worker.** After an `applied` outcome, the server SHALL wake the job worker.

#### Scenario: Duplicate webhook

- **WHEN** the same verified notification arrives twice
- **THEN** the order becomes `paid` once, one `publish.finalize.v1` and one `payment_received` job
  exist, and the second delivery changes nothing

#### Scenario: Amount mismatch

- **WHEN** a verified payment of `10000` arrives for an order of `49000`
- **THEN** the order stays as it was, the record holds `amount_mismatch`, and operations are told

#### Scenario: Out-of-order notifications

- **WHEN** a verified payment arrives for an order the owner's newer checkout had closed as
  `cancelled`
- **THEN** the order becomes `paid` and is fulfilled, because money was received for it

### Requirement: Payment reconciliation

**The job.** Each checkout SHALL enqueue, in its transaction, one `payment.reconcile.v1` job
(`{ orderId }`). It becomes due 2 minutes after the order's `expiresAt`, and has a budget of 6
attempts.

**Reconciliation.** It reads the provider's verified status of a `pending` order:

- **`PAID`:** recorded as a verified payment of `amountPaid`, with the reference
  `reconciliation:{orderCode}` and the source `reconciliation`;
- **`CANCELLED` or `EXPIRED`:** closes the order;
- **any other status, or an unreachable provider:** a retryable failure.

A job for an order that is no longer `pending` SHALL complete without effect. The order status
endpoint SHALL reconcile a `pending` order the same way before it answers.

#### Scenario: Browser closed before return

- **WHEN** the owner pays and closes the browser before the return page, and the notification is
  lost
- **THEN** the reconciliation job reads `PAID`, applies the payment, and the gift is published

#### Scenario: Return URL forged

- **WHEN** someone opens `/checkout/return?order={orderId}&code=00&status=PAID` for an order the
  provider still reports `PENDING`
- **THEN** the order stays `pending`

### Requirement: Paid order fulfillment

`publish.finalize.v1` (budget 6) SHALL publish the gift of a `paid` order:

- by its owner's authority;
- the gift's current revision;
- on the order's exact `planVersion`, with the entitlement `source` `order`;
- with the order id as the publish idempotency key (`gift-publishing` "Idempotent publish").

The publish transaction SHALL move the order from `paid` to `fulfilled` (with `fulfilledAt`).

**Outcomes:**

- an order that is not `paid` is skipped;
- a concurrent change of the gift is a retryable failure;
- a gift that cannot be published as it is fails the job without retry, and the order stays `paid`.
  Examples: content issues, a template version that cannot be published, or a deleted gift.

**Finishing in the Studio.** While a gift has a `paid` order, its owner MAY publish it in the
Studio on that plan without another checkout. That publish fulfills the order the same way.

#### Scenario: Paid but finalize fails, then retry

- **WHEN** fulfillment of a paid order conflicts with a concurrent save
- **THEN** the job is retried, and the next attempt publishes the gift and fulfills the order

#### Scenario: Paid gift that cannot be published yet

- **WHEN** a photo of a paid order's gift failed after checkout
- **THEN** the order stays `paid`, the job is dead with `FINALIZE_INVALID_CONTENT`, and the Studio
  offers `Tiêu chuẩn` with `Đã thanh toán. Bấm Xuất bản để hoàn tất.`

### Requirement: Admin order lookup

`/admin/orders` SHALL let an admin who passed the admin guard (`admin-access`) search orders by exact
order id, order code or gift public id, at most 20 results, newest first.

**The view.** Each order shows its code, id, status, plan and version, amount, provider, gift link,
and its creation, payment and fulfillment times, followed by its recorded payments. Each payment
shows its time, source, amount and outcome, never its reference.

**Audit.** Every search SHALL record `admin.order.looked_up` (`audit-log`) before anything is shown,
with the number of matches and the first order as target. The searched text is never recorded.

#### Scenario: Support finds an order

- **WHEN** an admin searches the order code of a fulfilled order
- **THEN** the order shows `fulfilled` with its payment `Đã ghi nhận`, and
  `admin.order.looked_up` is recorded
