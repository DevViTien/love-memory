# Sprint 1 implementation result

Date: 2026-09-16
Branch: `feat/sprint-1-core-domain-auth`

## Delivered

- Better Auth 1.7 passwordless magic-link route, MongoDB adapter, 30-day sessions, database-backed
  rate limits, creator/admin role field and server-side session DAL.
- Resend email adapter with generic UI responses, ten-minute single-use tokens and hashed token
  storage. Login URLs and tokens are never logged.
- Anonymous draft identity in an HttpOnly, SameSite=Lax cookie using a 256-bit secret; first-create
  credentials are deterministically recoverable from a high-entropy idempotency key and the server
  secret so a lost response can be replayed safely.
- Gift draft creation, owner/anonymous authorization, claim flow, versioned content and atomic
  optimistic concurrency with structured HTTP 409 responses.
- Immutable `giftRevisions` writes in the same MongoDB transaction as create/update.
- Reproducible collection validators and named indexes for auth, templates, gifts, revisions,
  assets, idempotency and outbox collections.
- Three published template manifests and validated preview fixtures seeded into MongoDB.
- Catalog/detail pages backed by the persisted registry, plus Studio shell, generic content editor,
  loading/empty/error states and passwordless sign-in page.
- JSON media-type, same-origin and Fetch Metadata checks on gift mutations, plus MongoDB-backed
  distributed rate limits.
- Transactional gift-create idempotency with a 24-hour TTL and browser-generated UUID keys.
- GitHub Actions MongoDB replica-set service, schema seed/verification and transaction verification
  before browser tests.

## Post-review hardening

- Passwordless users with Better Auth's empty display name now pass the session DAL; the real
  magic-link lifecycle is covered by browser tests rather than only a mocked HTTP response.
- Template catalog reads only each published template's `currentVersion`; existing gifts can keep
  editing immutable retired versions.
- User and anonymous-cookie credentials are evaluated together in one repository authorization
  filter, so a signed-in creator can claim and edit the draft created before sign-in.
- Schema v3 fixes the scheduled-access index, enforces ownership credential invariants, validates
  rate-limit/idempotency records and verifies validators, full index definitions/options and the
  migration ledger.
- Invalid/expired magic links now show a safe user-facing error, and claim network failures leave
  the UI recoverable.
- Create replays are bound to both the original actor and template request, then re-authorized
  against the gift's current owner. A claimed draft therefore cannot be recovered with its old
  anonymous idempotency key.
- Failed optimistic updates are re-read through the same authorization filter, so concurrent
  ownership changes cannot disclose the current revision of another creator's gift.
- Mutation origin checks normalize proxy protocol/host values, rate-limit subjects use keyed HMAC
  hashes, and unauthenticated IP limits accept only Vercel's sanitized forwarding header.
- Sign-in and sign-out controls recover from provider and transport failures without remaining
  disabled.
- Global navigation reflects the live Better Auth session, showing `Tài khoản` after a successful
  magic-link callback and returning to `Đăng nhập` after logout.

## Verification

- MongoDB migration and seed completed against the configured Atlas development database.
- The Vercel Preview environment is configured to use the separately migrated and seeded
  `love_memory_preview` database. The next Preview deployment will pick up that environment value.
- `db:verify` confirmed all required collections and named indexes.
- `db:verify-gifts` passed against Atlas: anonymous owner access, cross-owner denial, revision 0 to 1,
  stale-write rejection and authenticated claim. Temporary documents were removed in `finally`.
- Unit/integration coverage: 56 files, 205 tests; 91.59% statements and 84.15% branches at the final
  implementation checkpoint.
- Chromium desktop/mobile production smoke: 18 tests passed, including payload-bound replay,
  anonymous create/edit, real passwordless sign-in, claim, post-claim edit, revoked anonymous
  replay and authentication failure recovery.
- Installed Chrome on Windows production smoke: 9 tests passed.
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
