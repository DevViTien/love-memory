# Proposal

## Why

The Sprint 0–2 code review found that media upload initialization cannot work against a real
MongoDB deployment: the client enables Stable API strict mode, and the quota reservation uses
`distinct`, which is not part of API Version 1, while also running parallel operations inside one
transaction. Unit tests use fakes, so nothing caught it. The same review found that any
syntactically valid, made-up anonymous cookie resets every mutation rate limit, that transaction
callbacks keep state from rolled-back attempts, and several Studio and processing defects. Gate M2
(Sprint 3) is an end-to-end create → upload → preview → publish flow, so these must be fixed and
proven against a real database first. This change sits between Sprint 2 and Sprint 3 in plan.md.

## What Changes

- Quota reservation reads active slots with Stable API commands only (`find` with a projection and
  `countDocuments`), runs them sequentially inside its transaction, and resets per-attempt state
  when the driver retries the transaction callback. `claimNext` resets its result the same way.
- Anonymous requests are always charged to a network guard as well: `network:ip:<address>` from the
  trusted Vercel header, or `network:unidentified` otherwise, at five times the scope limit. A forged
  anonymous cookie can no longer escape rate limiting.
- The placeholder is bounded to 24 pixels on its longest side, and a placeholder that would still
  exceed the stored limit is dropped instead of corrupting the asset record.
- Background drain dispatch is de-duplicated per asset instead of globally, so one user's upload
  cannot suppress the dispatch for another user's upload in the same 10-second window.
- The Studio reports the recovered order when saved assets are gone (including an empty list),
  allows only one select-crop-upload loop at a time, and re-encodes crops as JPEG when the browser
  cannot produce WebP, instead of uploading multi-megabyte PNGs from iOS.
- A new `db:verify-media` command exercises the media repositories against the configured MongoDB
  (quota slots, concurrent reservation, completion outbox, claim, failure, requeue, cleanup) and
  runs in CI next to `db:verify-gifts`.

## Non-goals

- Making the anonymous cookie self-authenticating (HMAC-bound draft IDs); the network guard bounds
  abuse without invalidating existing drafts.
- Per-attempt derivative keys, per-identity byte quotas, delayed dispatch for automatic retries and
  the crop dialog's focus handling; they are tracked for a later change.
- Admin tooling and draft retention (Sprint 6).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mutation-request-guards`: anonymous requests are also charged to a network guard bucket.
- `media-processing`: bounded placeholder; per-asset drain dispatch de-duplication.
- `studio-image-list-field`: recovery reports an emptied order; one selection loop at a time; JPEG
  fallback for crops.
- `database-schema-management`: new `db:verify-media` verification command.

## Invariants touched

- Long-running work through the outbox: unchanged, now verified against a real database.
- Private media: the crop fallback still uploads only the cropped, bounded image.
- Rate limits: tightened; signed-in users are unaffected.

## Impact

- Code: `modules/media/infrastructure/{mongo-media-repository,media-job-scheduler}.ts`,
  `modules/media/presentation/{media-route-handlers,media-image-list-field,image-crop}.ts(x)`,
  `app/api/media/**/route.ts`, `modules/media/application/media-worker.ts`,
  `packages/media/src/image-processor.ts`, `modules/gifts/infrastructure/mongo-gift-rate-limiter.ts`,
  `modules/gifts/presentation/gift-route-helpers.ts`, new `scripts/verify-media-persistence.ts`,
  `package.json`, `.github/workflows/ci.yml`.
- No migrations and no new environment variables.
