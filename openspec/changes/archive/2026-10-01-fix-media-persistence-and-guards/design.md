# Design

## Context

Governing decisions: ADR-0002 (MongoDB driver, Stable API, repositories), ADR-0003 (private media),
ADR-0008 (Trigger.dev and the outbox). All fixes are local; there is no schema migration.

## Decisions

### Quota reservation uses API Version 1 commands, sequentially

`distinct` is not in Stable API V1, and the client runs with `strict: true`, so the reservation
failed on every real server. The reservation now reads the occupied slots with one `find` that
projects `giftSlot` and `fieldSlot`, filtered by gift and active status. The field's slots and both
counts are derived in memory from that single result, which keeps the number of round-trips to one
and makes "parallel operations in one transaction" impossible. The partial unique slot indexes
remain the concurrency guard, and the existing duplicate-key retry loop is unchanged.

### Transaction callbacks own their result

`withTransaction` re-runs its callback on transient errors. Variables written by the callback
(`created` in `createWithinQuota`, `claimed` in `claimNext`) are reset as the first statement of the
callback, so a rolled-back attempt can never leak its result into a later successful one.

### Network guard for anonymous requests

The anonymous cookie is only validated for shape, so it cannot be trusted as a sole rate-limit key.
Rather than changing the cookie format (which would orphan existing drafts), every request whose
primary subject is `anonymous:` is also charged to `network:ip:<trusted address>` or
`network:unidentified`, at five times the scope limit. Signed-in users keep a single `user:` bucket.
`giftRateLimitSubjects` returns the ordered list of `{ subject, multiplier }` and the route helper
consumes each, rejecting on the first exhausted bucket and reporting the longest retry window.

### Placeholder bounded on both sides

The placeholder resize uses `fit: "inside"` with both width and height of 24. The worker also
drops a placeholder longer than the domain's 2000-character limit instead of writing a value that
would make every later read of that asset fail schema parsing.

### Per-asset drain dispatch key

The Trigger.dev idempotency key becomes `media-worker-drain:{source}:{assetId}:{10s window}`. The
`media-worker` queue keeps concurrency 1, so extra dispatches during a burst only queue short idle
runs, which is cheaper than a five-minute stall for another creator.

### Studio fixes

- `refresh()` compares the recovered order with the saved order (`orderRef`), not with the empty
  in-memory list, so an emptied field is reported and the draft becomes savable again.
- A `selecting` ref and state guard `selectFiles`: a second selection is ignored and the picker is
  disabled until the current loop finishes. `requestCrop` revokes any previous object URL.
- The crop requests WebP; if the browser returns another type it re-encodes the same canvas as JPEG
  at quality 0.9. The canvas is shrunk to 0x0 afterwards to release its backing store on iOS.

### `db:verify-media`

Modelled on `db:verify-gifts`: a script that calls the real repository adapters with a random gift
ID and cleans up in `finally`. Concurrency is exercised with `Promise.all` over more reservations
than the field limit. It runs in CI after `db:verify-gifts`, against the same replica set.

## Risks

- A carrier-grade NAT shares one `network:ip:` bucket among many anonymous creators. At five times
  the scope limit (for example 300 draft updates per minute) this is acceptable for Gate M2 and is
  revisited when autosave frequency is chosen in Sprint 3.
