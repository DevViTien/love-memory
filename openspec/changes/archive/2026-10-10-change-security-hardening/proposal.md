# Change security hardening

## Why

Plan.md §15.4–§15.5 and Gate M5 require that critical and high security issues are closed or
mitigated before the release candidate. The Sprint 6 plan (change 7) lists the items:

- HSTS and the remaining security headers;
- rate-limit coverage (debts D1, D2, D18);
- a session and cookie review;
- a broken-access-control test pass;
- a credential-rotation procedure;
- a backup and restore runbook with an RPO and an RTO.

Today:

- no `Strict-Transport-Security` header is sent;
- several owner and admin routes have no rate limit;
- the limiter lives in `gifts/infrastructure` behind an ESLint allowlist;
- only some cross-user access paths have negative tests;
- nothing documents rotating secrets or restoring the database.

## What Changes

- **Headers.** Every response also carries:
  - `Strict-Transport-Security: max-age=63072000`;
  - `Cross-Origin-Opener-Policy: same-origin`;
  - `X-Permitted-Cross-Domain-Policies: none`.
- **Rate-limit coverage:**
  - **`gift-read`** (120/60 s): `GET /api/gifts/{publicId}` and the owner export.
  - **`media-read`** (120/60 s): photo listing and reads.
  - **`media-write`** (60/60 s): upload completion, photo deletion and retry.
  - **`admin-action`** (60/60 s per admin): template versions, report actions and MFA enrollment.
  - **D1, the `/g` and `/preview` page renders,** is covered by documented Vercel Firewall rules.
    Their data endpoints are already limited, and 128-bit share ids make enumeration pointless.
- **Limiter as a port (D2, D18).**
  - **The move.** The limiter moves to `modules/rate-limits`:
    - a `RateLimiter` port;
    - pure subject helpers;
    - a Mongo adapter, wired once in `composition/rate-limits.ts`.
  - **The fold (D18).** The duplicated wrappers fold into it.
  - **The allowlist.** The ESLint allowlist of presentation-to-infrastructure imports becomes
    empty. The anonymous draft cookie helpers are reached through composition.
- **Secret scan.** It also detects Resend and Trigger.dev keys, and skips files deleted in the
  working tree instead of crashing.
- **Broken-access-control pass.** A new end-to-end journey has a second signed-in user try every
  owner route and page of another user's gift; each must answer not-found.
- **Session and cookie review.** It is recorded in a new runbook:
  - auth and draft cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production builds (every
    Vercel tier);
  - sessions last 30 days, refreshed daily;
  - the magic link expires in 10 minutes and is stored hashed.

  No change is needed.

- **Runbooks:**
  - `docs/runbooks/credential-rotation.md`: every secret the app reads, its impact and its rotation
    steps;
  - `docs/runbooks/backup-and-restore.md`: the Atlas backup policy, a target RPO of 24 hours and an
    RTO of 4 hours, the restore-to-staging drill, and object storage expectations.
- **Schema version 16:** the four new rate-limit scopes in the `apiRateLimits` validator.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `content-security-policy`: "Baseline security headers".
- `mutation-request-guards`: "Distributed mutation rate limits".
- `database-schema-management`: "JSON-schema validators", "Idempotent migration with ledger" and
  "Schema verification", for version 16.
- `privacy-notice`: "Privacy notice page": the notice also states that backups holding a deleted
  gift expire within 7 days, as found while writing the backup runbook.

## Non-goals

- In-app rate limits on page renders, with a designed `429` page. Vercel Firewall rules cover D1;
  revisit if the app moves off Vercel.
- `__Host-` cookie prefixes. They would rename live cookies and sign every user out, for no gain on
  HTTPS-only tiers.
- A Content-Security-Policy change. It is already route-specific (ADR-0005).
- Restoring a real backup. The drill is a Sprint 7 task (plan.md §16.4); this change writes the
  procedure.

## Impact

- **Code:**
  - `next.config.ts`;
  - `modules/rate-limits` (new), `composition/rate-limits.ts` and `composition/anonymous-draft.ts`;
  - every caller of the limiter;
  - the media, gift, export and admin route handlers;
  - `eslint.config.mjs`, `scripts/check-secrets.mjs`, `packages/database`.
- **Invariants:**
  - **Authorization and opaque `404`.** Unchanged, and now covered end to end across users.
  - **Logging.** No sensitive logging is added.
  - **Mutation guards.** They keep their order; the new limits run after authentication context
    and before the body is read.
