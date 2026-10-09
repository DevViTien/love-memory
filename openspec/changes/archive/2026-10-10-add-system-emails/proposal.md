# Add system emails

## Why

A creator learns nothing by email after signing in:

- not that their gift is live;
- not that a photo could not be processed;
- not that their gift was taken down. The Sprint 6 takedown deferred its owner notice to this
  change.

Plan.md §14.5 lists system emails for Sprint 5 ("Payment received", "Gift published", "Processing
failed cần hành động"), and requires that an email never contains the gift's private content. This
is Sprint 5 change 3 ([sprint-5-plan.md](../../../docs/sprints/sprint-5-plan.md)).

## What Changes

- **The job.** A generic background job `email.send.v1` (`background-jobs`) sends one system email
  to the owner of a gift.
  - **Payload.** It carries only the email kind, the gift id and an event key. The job looks the
    owner's address up when it runs, so no address ever sits in the outbox.
  - **Skipped.** Gifts without a signed-in owner, and gifts deleted meanwhile, are skipped.
- **Three kinds,** each enqueued in the same transaction as the event that causes it:
  - **`gift_published`:** a first publish (not an update);
  - **`photo_processing_failed`:** a photo's processing fails for good (terminal code, or the last
    attempt);
  - **`gift_taken_down`:** an admin or emergency takedown (`abuse-reports`).
- **Content.** Each email has a Vietnamese subject, a short text and a link to the gift's Studio
  page. It never contains gift text, captions, photos, the share link or the report's details.
- **Delivery.**
  - **Sending.** An `EmailSender` port with a Resend adapter, reusing `RESEND_API_KEY` and
    `AUTH_EMAIL_FROM`.
  - **Idempotency.** The job's deduplication key is the Resend idempotency key, so a retried send
    after a crash never sends twice.
  - **Capture.** The existing capture file (`AUTH_EMAIL_CAPTURE_PATH`) also records system emails
    locally and in E2E.

## Capabilities

### New Capabilities

- `system-emails`: the email job, the kinds, their content rules and delivery.

### Modified Capabilities

- `gift-publishing`: "Immutable publication snapshot": a first publish also enqueues
  `gift_published`.
- `media-processing`: "Decoded content verification and failure codes": a final failure enqueues
  `photo_processing_failed`.
- `abuse-reports`: "Takedown": a takedown enqueues `gift_taken_down`.

## Non-goals

- **The "payment received" email.** It arrives with orders in `add-payment-webhook-fulfillment`
  (Sprint 5 change 5), as another kind of the same job.
- **Other emails:** the scheduled reminder and the owner delete confirmation (they wait for Sprint 4
  features), reporter notifications, and marketing email of any kind.
- **Email preferences or unsubscribe.** These are transactional emails about the owner's own gift.
- **HTML templates beyond a minimal layout.**

## Impact

- **Code:**
  - `modules/notifications` (new);
  - the publish, media-failure and takedown transactions (one enqueue each);
  - `composition/jobs.ts` (a new handler) and `composition/notifications.ts`.
- **Invariants:**
  - **Retryable work through the outbox.** Sending happens only in the job, never in a request.
  - **No gift content in emails or logs.** The job logs only its id, type and error code, and the
    payload holds identifiers only.
  - **Authorization.** An email goes only to the gift's current owner, read at send time.
