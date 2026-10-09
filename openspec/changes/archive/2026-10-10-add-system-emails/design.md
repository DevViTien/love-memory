# Design: system emails

## Context

- **Existing email.** Magic-link emails go through Resend (`RESEND_API_KEY`, `AUTH_EMAIL_FROM`), or
  through a JSONL capture file (`AUTH_EMAIL_CAPTURE_PATH`) on loopback development and E2E servers.
- **Existing jobs.** The generic job runtime (`background-jobs`) runs idempotent handlers from the
  outbox. It runs inline in development and E2E, and on Trigger.dev on every Vercel tier.
- **The three events** each already commit in one transaction:
  - first publish (`mongo-gift-repository` publish);
  - final photo failure (`mongo-media-repository` `fail` and the claim paths that close an
    exhausted job);
  - takedown (`applyTakedown` in `mongo-moderation`).

## Decisions

### D1. One generic job with an event key

**Choice.** One job type `email.send.v1` with payload `{ kind, giftId, eventKey }`.

- **Deduplication key.** `email.send.v1:{kind}:{giftId}:{eventKey}`, built by `systemEmailJob`.
- **Idempotency key.** The handler rebuilds the same key from the payload and passes it to Resend.
  A retried send is therefore deduplicated by the provider for 24 hours, and the outbox upsert
  deduplicates the enqueue itself.
- **Rejected:** one job type per kind (more registrations for the same code), and putting the
  address in the payload (a stale address, and personal data in the outbox).

### D2. Read the owner when sending

**Choice.** The handler reads the gift (not `deleting`) and its owner's `users.email` through
`authIdFilter`, since Better Auth ids are BSON UUIDs.

- **When the job sends nothing.** A gone gift, a gift being deleted, an anonymous gift and an owner
  without an address all complete without sending.
- **Ownership changes.** A claim between the event and the send emails the new owner, who now
  manages the gift.

### D3. Content cannot leak by construction

**Choice.** `composeSystemEmail(kind, studioUrl)` takes nothing but the kind and the Studio link.
The handler never loads gift content, so no gift text, share link, price or report detail can reach
an email.

**Logging.** A provider error is rethrown as `JobFailure("EMAIL_SEND_FAILED", retryable)`, without
the provider's message, which may echo the address.

### D4. Wake-ups after commit

The enqueue is in each event's transaction. After the commit, the caller wakes the worker:

| Event               | Who wakes the worker                         |
| ------------------- | -------------------------------------------- |
| First publish       | The gift service dispatches `email.send.v1`. |
| Admin takedown      | The moderation service (`notifyOwner`).      |
| Emergency takedown  | The report service (`notifyOwner`).          |
| Final photo failure | The media worker (`wakeEmailJobs`).          |

A lost wake-up is caught by `jobs-sweep` on Vercel tiers.

### D5. A configuration of its own

**Choice.** `config/system-email.ts` reads `APP_URL`, `AUTH_EMAIL_FROM`, `RESEND_API_KEY` and the
optional capture path. The capture path is accepted only on a loopback `APP_URL`.

- **Rejected:** reusing the auth environment, which would require `BETTER_AUTH_SECRET` in the
  Trigger.dev environment.
- **Operator step.** The Trigger.dev environment of each tier needs the three variables (runbook
  updated).

### D6. Media failure email covers every final path

All three paths that leave a photo `failed` for good enqueue the email in their transaction:

- `fail()` when no retry remains (`retryAt === null`);
- a stale exhausted lease;
- an unclaimable `processing` asset.

`fail()` now uses `findOneAndUpdate` with a projection, to learn the asset's `giftId` inside the
transaction. One email per asset follows from the event key.

## Risks

- **A photo-failure email per photo.** An owner who uploads several broken photos gets several
  emails. This is acceptable for now; batching would need a delay window.
- **Missing Trigger.dev variables.** Emails dead-letter (`EMAIL_SEND_FAILED` is retryable, so after
  6 attempts) until they are set. Then `pnpm jobs:retry` resends, and the idempotency key still
  prevents duplicates within 24 hours.
