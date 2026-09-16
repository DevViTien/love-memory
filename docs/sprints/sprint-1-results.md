# Sprint 1 implementation result

Date: 2026-09-16  
Branch: `feat/sprint-1-core-domain-auth`

## Delivered

- Better Auth 1.7 passwordless magic-link route, MongoDB adapter, 30-day sessions, database-backed
  rate limits, creator/admin role field and server-side session DAL.
- Resend email adapter with generic UI responses, ten-minute single-use tokens and hashed token
  storage. Login URLs and tokens are never logged.
- Anonymous draft identity in an HttpOnly, SameSite=Lax cookie using a 256-bit random secret.
- Gift draft creation, owner/anonymous authorization, claim flow, versioned content and atomic
  optimistic concurrency with structured HTTP 409 responses.
- Immutable `giftRevisions` writes in the same MongoDB transaction as create/update.
- Reproducible collection validators and named indexes for auth, templates, gifts, revisions,
  assets, idempotency and outbox collections.
- Three published template manifests and validated preview fixtures seeded into MongoDB.
- Catalog/detail pages backed by the persisted registry, plus Studio shell, generic content editor,
  loading/empty/error states and passwordless sign-in page.
- GitHub Actions MongoDB service and seed step for browser smoke tests.

## Verification

- MongoDB migration and seed completed against the configured Atlas development database.
- `db:verify` confirmed all required collections and named indexes.
- `db:verify-gifts` passed against Atlas: anonymous owner access, cross-owner denial, revision 0 to 1,
  stale-write rejection and authenticated claim. Temporary documents were removed in `finally`.
- Unit/integration coverage: 54 files, 186 tests; 93.2% statements and 85.96% branches at the final
  implementation checkpoint.
- Chromium desktop/mobile production smoke: 12 tests passed.
- Installed Chrome on Windows production smoke: 6 tests passed.
- Production Next.js build, TypeScript, ESLint, Prettier, dependency audit and secret scan passed.

## External configuration still required

Passwordless delivery cannot be verified live until Preview has `BETTER_AUTH_URL`,
`BETTER_AUTH_SECRET`, `AUTH_EMAIL_FROM` and `RESEND_API_KEY`. The sender domain must be verified by
the email provider. Follow [the passwordless runbook](../runbooks/passwordless-auth.md), then test
single use, expiry and logout in Preview before calling the authentication deliverable complete.
