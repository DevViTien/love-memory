# Design

## Context

For the why and the scope, see proposal.md. The relevant code at `4769c76`:

- **Headers.** `next.config.ts` sends four baseline headers on every path. There is no HSTS.
  `apps/web/vercel.json` holds no headers.
- **The limiter.** `modules/gifts/infrastructure/mongo-gift-rate-limiter.ts` holds the scopes, the
  Mongo counters and the subject helpers. It is imported by:
  - four composition files;
  - two presentation files, through an ESLint allowlist (debt D2).

  `composition/analytics.ts` and `composition/public-gifts.ts` wrap it (debt D18).

- **Unlimited routes:**
  - `GET /api/gifts/{publicId}`;
  - the media complete, list, read, delete and retry routes;
  - the admin template-version, report-action and MFA-enroll routes;
  - the page renders of `/g` and `/preview` (debt D1).
- **Cookies.** `HttpOnly`, `SameSite=Lax`, `Secure` when `NODE_ENV` is `production`. Every Vercel
  build is a production build.
- **No runbook** covers rotation of all secrets, or backups.

Governing ADRs: ADR-0001 (adapters wired in composition), ADR-0005 (route-specific CSP),
ADR-0007 (auth).

## Goals / Non-Goals

**Goals:**

- Every API route has an explicit limit or a recorded reason not to.
- No presentation code imports infrastructure.
- An operator can rotate any secret and restore the database from a written procedure.

**Non-Goals:** see proposal.md.

## Decisions

### 1. Headers

Three headers join the global entry:

- **`Strict-Transport-Security: max-age=63072000`.** Two years. Browsers ignore it over HTTP, so
  local development and the HTTP E2E server are unaffected. `includeSubDomains` and `preload` are
  left out: other subdomains of a future custom domain are not ours to commit.
- **`Cross-Origin-Opener-Policy: same-origin`.** No page opens, or is opened by, another window.
  The template iframe is a frame, not an opener, so it is unaffected.
- **`X-Permitted-Cross-Domain-Policies: none`.**

`Cross-Origin-Resource-Policy` is left out on purpose. The opaque-origin template iframe loads
`runtime.mjs` from `/template-artifacts/`, and a `same-origin` CORP would block it.

### 2. The limiter as a port (D2, D18)

`modules/rate-limits`:

- **`application/rate-limiter.ts`:** the `ApiRateLimitScope` union, `RateLimitResult`, the
  `RateLimiter` port, and `consumeAll(limiter, scope, subjects)` (charge in order, stop at the
  first refusal).
- **`application/rate-limit-subjects.ts`:** the pure subject helpers (network, IPv6 `/64`, link,
  session and gift subjects) and the shared-bucket rule. They are unchanged.
- **`infrastructure/mongo-rate-limiter.ts`:** the per-scope limits, `consumeApiRateLimit` (moved
  unchanged) and `createMongoRateLimiter(getSecret)`.

`composition/rate-limits.ts` exports the one `rateLimiter`, keyed with the auth secret.

**Callers.**

- `gift-route-helpers.ts` uses `rateLimiter` and `consumeAll`.
- The composition wrappers call `rateLimiter.consume`.
- The two allowlisted presentation files import only application modules.

**The allowlist.** The ESLint allowlist is removed. Its removal surfaced one more import of
infrastructure from presentation (the anonymous draft cookie helpers), now re-exported by
`composition/anonymous-draft.ts`.

Behavior, counter keys and limits are unchanged; the existing limiter tests moved with the code.

### 3. New limits

| Scope          | Routes                                                          | Subject                                                                       | Limit    |
| -------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------- |
| `gift-read`    | `GET /api/gifts/{publicId}`, `GET /api/gifts/{publicId}/export` | the gift subjects (`user:`, or `anonymous:` plus the network, or the network) | 120/60 s |
| `media-read`   | asset list and read                                             | the gift subjects                                                             | 120/60 s |
| `media-write`  | upload completion, asset delete and retry                       | the gift subjects                                                             | 60/60 s  |
| `admin-action` | template versions, report actions, MFA enrollment               | `user:{adminId}`, never a shared bucket                                       | 60/60 s  |

**Where each limit runs:**

- **Gift and media routes** run the limit after the request context is read and before the
  service, through `enforceGiftMutationRateLimit`.
- **Admin routes** run it after the admin guard and the JSON guards, through an injected `limit`
  dependency (`limitAdminAction` in `composition/admin.ts`).

**Why the numbers.** The budgets are generous: the Studio polls the asset list while photos
process, and autosaves. They exist to bound scraping and accidental loops, not normal use.

**Page renders (D1).** These are covered by two Vercel Firewall rate-limit rules, documented in the
deployment runbook:

- `/g/*`: 120 requests per minute per IP;
- `/preview/*`: 60 requests per minute per IP.

The data endpoints behind both pages are already limited in-app. A share id or a preview token is
128 bits or more, so enumeration through the pages is not a practical threat.

### 4. Schema version 16

The `apiRateLimits` validator gains the four scopes. There is no other change, and no backfill.

### 5. Broken-access-control journey

`e2e/access-control.spec.ts`:

1. Owner A publishes a gift and keeps a draft.
2. User B, signed in through another browser context, calls every owner route of A's gifts with
   the same-origin `fetch` the Studio uses:
   - the draft read, save, preview, claim, publish, pause, resume, delete and export;
   - the media list.

   Each must answer `404`.

3. B also opens A's Studio page, and must see the not-found page.

The test complements the existing unit-level opaque-`404` tests with real sessions.

### 6. Session and cookie review, runbooks

**The review**, recorded in `docs/runbooks/credential-rotation.md`:

- the cookie attributes and session lifetimes as configured;
- the magic link: 10 minutes, hashed, 5 per 5 minutes per IP;
- the conclusion that no change is needed. On Vercel `NODE_ENV` is always `production`, so
  `Secure` is always set; a `__Host-` rename would sign everyone out for no gain.

**`credential-rotation.md`** lists, for each variable:

- what it protects;
- the impact of rotating it (for example, `BETTER_AUTH_SECRET` without a rollover invalidates
  sessions and rate-limit keys);
- the steps.

**`backup-and-restore.md`** covers:

- the Atlas backup requirement (a cluster tier with continuous or daily snapshots);
- a target RPO of 24 hours and RTO of 4 hours, owned by the Tech Lead;
- the restore-to-staging drill;
- verifying with `db:verify` and `db:verify-gifts`;
- private Blob objects, which are not backed up: a lost object is a lost photo, so Blob durability
  is the provider's.

## Risks / Trade-offs

- **HSTS on a future custom domain** commits that host to HTTPS for two years. This is intended.
- **New limits could hit a heavy Studio session.** The budgets are well above the autosave and
  polling rates; a `429` is retried by the existing clients.
- **The refactor touches many files.** It is covered by the moved tests and the full suite. No
  counter key changes, so live counters stay valid.

## Migration Plan

1. Deploy, then run `pnpm db:migrate` and `pnpm db:verify`.
2. Add the two Vercel Firewall rules on each tier.
3. Check the response headers on `/`.

Rollback: the previous build ignores the new scopes. Its `db:verify` reports drift.
