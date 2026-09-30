# Proposal

## Why

Writing the baseline specs for Sprints 0–2 surfaced behavior that contradicts the product's own
invariants and ADRs: an expired magic link shows no explanation, technical spikes can be switched on
in Production, some anonymous creates bypass rate limiting, terminally failed uploads keep the
creator's original photo in storage, and any `admin` user can open every gift without the MFA that
ADR-0007 requires. Gate M2 (Sprint 3) builds directly on these surfaces, so they are fixed first.
This change sits between Sprint 2 and Sprint 3 in plan.md.

## What Changes

- The sign-in page explains every failed magic-link verification (invalid, expired, reused, or a
  provider error), not only the synthetic `invalid-link` value the provider overwrites.
- Technical spikes are always disabled when `VERCEL_ENV` is `production`, whatever the spike
  variables say.
- Mutations with no identifiable subject share one `unidentified` rate-limit bucket (five times the
  per-subject limit) instead of being unlimited.
- A media asset whose processing fails terminally, including after the last retry or an exhausted
  stale lease, has its source object deleted, as ADR-0003 requires.
- **BREAKING (internal only)**: the `admin` role no longer grants access to other creators' drafts;
  admin access returns with MFA in the Sprint 6 admin work.
- `/viewer` opts out of prerendering explicitly like `/studio`, because it is served with a nonce
  policy.
- Template artifacts under `/template-artifacts/` are sent with `X-Frame-Options: SAMEORIGIN`
  instead of a `DENY` that contradicts their `frame-ancestors 'self'` policy.
- The Studio crop labels the upload with the format the browser actually encoded, so a browser
  without WebP canvas encoding uploads a valid PNG instead of a mislabeled file that fails.
- A failed readiness probe reports `SERVICE_UNAVAILABLE` instead of `INTERNAL_ERROR`.

## Non-goals

- Admin tooling, MFA and audit (Sprint 6).
- Retention and deletion of abandoned drafts and their ready assets (Sprint 6 privacy work).
- Wiring real gift payloads, audio and assets into the Viewer (Sprint 3).
- Blocking the spike lab page itself behind the token; its APIs already require it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `creator-authentication`: the sign-in page explains any magic-link verification error.
- `technical-spikes`: spikes cannot be enabled in the Vercel Production environment.
- `mutation-request-guards`: unidentifiable requests share a bounded `unidentified` bucket.
- `media-processing`: terminal `PROCESSING_FAILED` deletes the source object.
- `gift-draft-ownership`: the `admin` role no longer bypasses draft authorization.
- `content-security-policy`: `/viewer` is dynamic; artifacts get `X-Frame-Options: SAMEORIGIN`.
- `studio-image-list-field`: the cropped file's type matches the encoded bytes.
- `health-checks`: readiness failures use `SERVICE_UNAVAILABLE`.

## Invariants touched

- Authorize inside the data-access filter: kept, and narrowed (no role bypass).
- Never log tokens: the sign-in error mapping never echoes the provider's error description.
- Private media: terminal failures no longer leave the original photo in storage.

## Impact

- Code: `apps/web/src/app/auth/sign-in/page.tsx`, `modules/auth/presentation`,
  `config/technical-spikes.ts`, `modules/gifts/{presentation,infrastructure,application}`,
  `modules/media/{application,infrastructure,presentation}`, `app/viewer/layout.tsx`,
  `next.config.ts`, `app/api/health/ready/route.ts`, `scripts/verify-gift-persistence.ts`.
- Docs: `docs/architecture.md`, ADR-0003, ADR-0007, `docs/runbooks/media-pipeline.md`,
  `templates/README.md`.
- No migrations and no new environment variables (`VERCEL_ENV` is provided by Vercel).
