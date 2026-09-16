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
- The Vercel branch Preview uses a separately migrated and seeded `love_memory_preview` database.
- `db:verify` confirmed all required collections and named indexes.
- `db:verify-gifts` passed against Atlas: anonymous owner access, cross-owner denial, revision 0 to 1,
  stale-write rejection and authenticated claim. Temporary documents were removed in `finally`.
- Unit/integration coverage: 54 files, 186 tests; 93.2% statements and 85.96% branches at the final
  implementation checkpoint.
- Chromium desktop/mobile production smoke: 12 tests passed.
- Installed Chrome on Windows production smoke: 6 tests passed.
- Production Next.js build, TypeScript, ESLint, Prettier, dependency audit and secret scan passed.
- Passwordless delivery was verified on the protected Vercel Preview with Resend's
  `onboarding@resend.dev` test sender. Runtime logs confirmed the sign-in request, magic-link
  callback and redirect to `/studio/new` without server errors.

## Known Preview limitation

The shared `resend.dev` test sender can send only to the email address associated with the Resend
account, and the verification email landed in Gmail Spam during the live check. Production still
requires a verified sender domain and separate Production auth secret, database and environment
configuration. Follow [the passwordless runbook](../runbooks/passwordless-auth.md) before promoting
the authentication flow to Production.
