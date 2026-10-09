# Tasks: add-system-emails

## 1. Notifications module

- [x] 1.1 `modules/notifications/application/system-emails.ts`: the kinds, `systemEmailJob` and
      `systemEmailKey`, `composeSystemEmail` (Vietnamese, Studio link only), and the
      `email.send.v1` handler (6 attempts, skips gone, deleting or anonymous gifts, retryable
      `EMAIL_SEND_FAILED` without the provider message).
- [x] 1.2 Infrastructure: a Resend sender with the idempotency key, a JSONL capture sender, and
      `mongoSystemEmailRecipients` (gift not `deleting`, owner address by `authIdFilter`).
- [x] 1.3 `config/system-email.ts`: `APP_URL`, `AUTH_EMAIL_FROM`, `RESEND_API_KEY`, and a
      loopback-only capture path.
- [x] 1.4 `composition/notifications.ts` and the registration in `composition/jobs.ts`
      (`REGISTERED_JOB_TYPES`).

## 2. Enqueue points

- [x] 2.1 First publish: `gift_published` in the publish transaction, and the gift service
      dispatches `email.send.v1` after it commits. An update enqueues no email.
- [x] 2.2 Final photo failure: `photo_processing_failed` in `fail()` when no retry remains, and in
      both claim paths that close an exhausted job. The media worker wakes the email worker.
- [x] 2.3 Takedown: `gift_taken_down` inside `applyTakedown`, for admin and emergency takedowns.
      The moderation and report services wake the worker.

## 3. Tests

- [x] 3.1 Unit tests: composition, the handler (send, skip, retry with the same key, strict
      payload), the senders, recipients, configuration, the repositories' enqueues, and the
      wake-ups.
- [x] 3.2 E2E (`abuse-reports.spec.ts`): the owner's captured `gift_published` and
      `gift_taken_down` emails, without the receiver's name, the share link or the report.

## 4. Documentation

- [x] 4.1 Background jobs runbook: the `email.send.v1` row, and the Trigger.dev variables.
- [x] 4.2 Credential rotation: `RESEND_API_KEY` also protects system emails, and is also set in
      Trigger.dev.
- [x] 4.3 Architecture: system emails in the background jobs section.

## Out of scope

- The "payment received" email, which comes with `add-payment-webhook-fulfillment`.
- Reminder and delete-confirmation emails, reporter notifications, and email preferences.
