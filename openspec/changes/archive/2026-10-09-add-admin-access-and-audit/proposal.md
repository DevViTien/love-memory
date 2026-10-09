# Proposal

## Why

Gate M5 (plan.md §15.7) needs operators who can act without touching MongoDB by hand: process
reports, pause and take down gifts, retire templates, follow deletions. Each of those actions needs
three things that do not exist yet:

- someone who is provably an administrator;
- a second factor on that account, because the role can pause any gift;
- an audit trail of what they did.

Users already carry a `role` field (`creator` or `admin`), but nothing reads it, and the code says
"admin access arrives with MFA and audit in the admin work" (`gift-route-helpers.ts`). This change
is that work. The actions themselves arrive with the next Sprint 6 changes, each writing to the
audit log built here.

Product Owner decisions of 2026-10-08 (`docs/sprints/sprint-6-plan.md`, A2 and A3) fix two points:

- Admins prove a second factor with an authenticator app (TOTP) and backup codes.
- The role is granted and revoked only by operator commands that write to the audit log. No screen
  can grant it.

## What Changes

- **Admin role, granted only by commands.**
  - `pnpm admin:grant <email>` and `pnpm admin:revoke <email>` set the user's `role` and write an
    audit record with the operator's identity (`--operator <name>`, required).
  - Revoking also ends every session of the user and their admin step-ups.
  - No API or page changes a role.
- **TOTP second factor for admins**, through Better Auth's `twoFactor` plugin in passwordless mode.
  The plugin stores the secret and the backup codes encrypted, and locks the factor after 10 failed
  codes for 15 minutes.
  - **Enrollment.** An admin without a factor is sent to `/admin/mfa`. The guarded route
    `POST /api/admin/mfa/enroll` returns the authenticator setup key, its `otpauth://` URI and 10
    backup codes, once.
  - **Activation.** The first valid code turns the factor on.
  - **Plugin HTTP endpoints disabled.** Every `/api/auth/two-factor/*` endpoint answers `404`
    (Better Auth `disabledPaths`). Only the admin routes use the factor, on the server, so a stolen
    session cookie cannot re-enroll a new secret or disable the factor.
  - **Reset only by command.** A lost device is reset only by `pnpm admin:reset-mfa <email>`
    (audited), which also ends the user's sessions and step-ups.
- **Admin step-up per session.** Magic-link sign-in has no second factor, so the admin area asks
  for one. A valid TOTP or backup code through `POST /api/admin/mfa/verify` records a step-up for
  the current session, valid for 12 hours. Signing out, revoking the role or the session ending
  ends it. The endpoint is rate limited per user (new scope `admin-mfa`, 10 per 600 seconds),
  together with the plugin's lockout.
- **One guard for the admin area.** `/admin` and every path under it, and every `/api/admin/*`
  route:
  - **Not an admin** (signed out, a creator, or an admin role on a deleted user): the same opaque
    not-found as an unknown path. The admin area never confirms that it exists.
  - **An admin without a factor or without a valid step-up:** only the `/admin/mfa` flow. Other
    admin APIs answer `403` `FORBIDDEN` with `details.reason` `MFA_REQUIRED`.
  - Every admin page is dynamically rendered, uses the nonce CSP, and is never cached.
- **Admin shell and gift lookup.**
  - **`/admin`** offers a search by gift `publicId`, `shareId` or internal id. A match shows only
    metadata:
    - status, template and version, plan and expiry, revisions;
    - creation, update and publication times;
    - the owner's user id and email;
    - asset counts by status.
  - **Nothing private is shown.** No content, captions, photos, passwords or links to signed media.
  - **Every lookup is audited**, including one that finds nothing.
  - **`/admin/audit`** lists the latest 100 audit records, optionally for one target id.
- **Audit log.** The new `auditLog` collection is append-only. Each record holds:
  - when it happened;
  - the actor (`admin` user id, or `operator` with a name);
  - the action (from a fixed list);
  - the target (kind and id);
  - the request id;
  - a small metadata object of ids and codes, never content.

  No API updates or deletes a record. Records expire after 365 days (TTL index).

- **Database schema version `13`:**
  - the collections `auditLog`, `adminStepUps` (TTL) and `twoFactors` (the plugin's model, unique
    `userId`);
  - the `admin-mfa` rate-limit scope.

This change belongs to **Sprint 6, Gate M5** (plan.md §15.1 Admin and §15.4 "Admin audit"). It is
the second Sprint 6 change. The template kill switch, gift pause and delete, and report takedown
build on its guard and audit log.

## Non-goals

- **Admin actions:**
  - pause, takedown and delete come with the gift pause and delete change and the abuse reports
    change;
  - the template kill switch comes with its own change;
  - asset retry, the dead-job list, and the order and payment views come with their changes.
- **Granular permissions** beyond one `admin` role (plan.md §15.1 "Role/permission" is satisfied
  with one role for the MVP team), and an `organization` model.
- **MFA for creators**, passkeys, email OTP and trusted devices.
- **A QR image for enrollment.** The setup key and URI work in every authenticator app; QR
  rendering arrives with the Sprint 4 QR work.
- **Searching gift content.** Plan.md §15.1 forbids broad private-content search by default.
- **Exporting or forwarding audit logs** to an external system.

## Invariants touched

- **Authorize inside the data-access filter; opaque `404`.**
  - The admin guard runs before any admin data access, and non-admins get the same not-found as an
    unknown path.
  - Admin reads are deliberately cross-owner. They are not creator routes, so creator ownership
    filters stay untouched. Every admin read is audited instead.
- **DTOs only; no raw documents; media by asset id only.** The lookup returns a metadata DTO, with
  asset counts but no asset ids, storage keys or URLs.
- **Never log gift text, tokens or signed URLs.**
  - Audit records and logs hold ids, actions and codes.
  - TOTP codes, secrets and backup codes are never logged or stored in plain text; the plugin keeps
    the secret and the backup codes encrypted with the auth secret.
- **Private routes use nonce CSP and dynamic rendering.** `/admin` joins the nonce routes. Its
  layout calls `connection()`, and every response is `no-store`.
- **Recipients need no account.** Unchanged.

## Capabilities

### New Capabilities

- `admin-access`: the admin role and its commands, TOTP enrollment, the per-session step-up, the
  admin-area guard, and the gift lookup.
- `audit-log`: the audit record, its append-only rule, retention, and the audit page.

### Modified Capabilities

- `content-security-policy`: `/admin` and paths under it use the nonce policy.
- `mutation-request-guards`: the `admin-mfa` rate-limit scope.
- `database-schema-management`:
  - the new collections, validators and indexes;
  - the `admin-mfa` scope in the `apiRateLimits` validator;
  - schema version `13`.

## Impact

- **Auth:**
  - `composition/auth.ts` adds `twoFactor({ allowPasswordless: true, issuer: "LoveMemory" })` with
    `modelName` `twoFactors`;
  - `session.ts` parses `twoFactorEnabled`.
- **New module `apps/web/src/modules/admin/`:**
  - application: the admin guard, the step-up service, the gift lookup service and the audit
    service;
  - infrastructure: the Mongo audit, step-up and lookup repositories;
  - presentation: the pages under `app/admin/` (layout, `page.tsx`, `mfa/page.tsx`,
    `audit/page.tsx`) and the routes `app/api/admin/mfa/enroll/route.ts` and
    `app/api/admin/mfa/verify/route.ts`.
- **Composition:** `composition/admin.ts`.
- **Security:** `security/content-security-policy.ts` (`/admin` → nonce), `proxy.ts` matcher
  check, and the `no-store` headers in `next.config.ts`.
- **Rate limits:** the `admin-mfa` scope in `mongo-gift-rate-limiter.ts`.
- **Database:** `packages/database` collections and migrations, version `13`.
- **Scripts:** `scripts/admin.ts` (`admin:grant`, `admin:revoke`, `admin:reset-mfa`) and
  `package.json`.
- **Tests:**
  - unit tests for each layer;
  - E2E: granting through the command, then the admin journey (enrollment, step-up, lookup, audit),
    plus a creator and a signed-out visitor getting not-found.
- **Docs:**
  - `docs/runbooks/admin-access.md` (granting, enrollment, lost device and backup codes,
    revocation);
  - `docs/architecture.md`;
  - an ADR-0007 note (passwordless plus a TOTP step-up for admins);
  - the risk register (admin account compromise);
  - the deployment runbook (schema version `13`).
- **No new dependency.** The `twoFactor` plugin ships with the pinned `better-auth`.
