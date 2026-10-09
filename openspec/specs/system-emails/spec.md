# system-emails Specification

## Purpose

Keeps a gift's owner informed by email about events that need their attention, without ever
putting the gift's private content into an email, a job or a log.

## Requirements

### Requirement: System email job

The system SHALL send each system email through one generic job `email.send.v1` (`background-jobs`).

**The job:**

- **Payload:** `{ kind, giftId, eventKey }` only, where `eventKey` identifies the event: `first`
  for a first publish, the asset id for a photo failure, the takedown time (ISO 8601) for a
  takedown, and the order id for a payment. No address, name or content.
- **Deduplication key:** `email.send.v1:{kind}:{giftId}:{eventKey}`.
- **Budget:** 6 attempts.

**When it runs,** the job SHALL read the gift and its owner's email address. It SHALL complete
without sending when:

- the gift no longer exists or is being deleted;
- the gift has no signed-in owner;
- the owner has no email address.

Otherwise it SHALL send exactly one email to that address. It SHALL use the deduplication key as
the provider's idempotency key, so a send retried after a crash is delivered at most once. A
provider failure SHALL be retryable. Email addresses, subjects and bodies MUST NOT be logged.

#### Scenario: Email to the owner

- **WHEN** an `email.send.v1` job of kind `gift_published` runs for a published gift
- **THEN** one email is sent to its owner's address, and the job completes

#### Scenario: Deleted gift skipped

- **WHEN** the job runs for a gift that is being deleted or no longer exists
- **THEN** no email is sent, and the job completes

#### Scenario: Provider failure retried once delivered

- **WHEN** the provider fails on the first attempt and succeeds on the second
- **THEN** exactly one email is delivered, with the same idempotency key on both attempts

### Requirement: Email kinds and content

The system SHALL know these kinds, each with a Vietnamese subject and a short plain-text body plus
an equivalent minimal HTML body:

| Kind                      | Subject                                  | Body says                                                                                                |
| ------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `gift_published`          | `Món quà của bạn đã sẵn sàng để gửi`     | The gift is published; manage it, pause it or delete it from its page.                                   |
| `photo_processing_failed` | `Một ảnh trong món quà chưa xử lý được`  | One photo could not be processed; open the gift's page to retry or replace it.                           |
| `gift_taken_down`         | `Món quà của bạn đã bị tạm khoá`         | The gift is locked after a report about its content; recipients cannot open it; the owner can delete it. |
| `payment_received`        | `Đã nhận thanh toán cho món quà của bạn` | The payment was received; the gift is being published, or can be finished from its page.                 |

Every email SHALL link to the gift's Studio page (`{APP_URL}/studio/{publicId}`).

It MUST NOT contain:

- the gift's text, captions, dates or photos;
- the share link;
- the plan price;
- any report detail.

#### Scenario: Published email holds no content

- **WHEN** the `gift_published` email is sent for a gift whose receiver is `Minh Thư`
- **THEN** it holds the subject `Món quà của bạn đã sẵn sàng để gửi` and the Studio link, and
  neither `Minh Thư` nor the share link

#### Scenario: Payment received email

- **WHEN** a verified payment is applied to an order
- **THEN** one `payment_received` email job is enqueued in the same transaction, keyed by the order
  id, and its email holds neither the amount nor the order code

### Requirement: Email delivery and capture

Emails SHALL be sent through the email provider configured for sign-in emails (`RESEND_API_KEY`,
`AUTH_EMAIL_FROM`), with Studio links on `APP_URL`. The job SHALL NOT need the auth secret. When `AUTH_EMAIL_CAPTURE_PATH` is set (local development and E2E only, as for
magic links), every system email SHALL instead be appended to that file as one JSON line holding
`kind`, `to`, `subject` and `text`.

#### Scenario: E2E capture

- **WHEN** a gift is published on the E2E server
- **THEN** the capture file gains a `gift_published` line addressed to the owner
