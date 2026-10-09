# Design

## Context

For why this change exists and what it delivers, see proposal.md. The code it builds on, as it
stands at `14e326c`:

- **Better Auth.** `composition/auth.ts` builds Better Auth 1.7.5 (`better-auth/minimal`). The only
  plugin is `magicLink`. Sessions last 30 days, with `httpOnly`, `sameSite: "lax"` cookies. Users
  have the additional field `role` (default `creator`, `input: false`).
- **Sessions.** `modules/auth/application/session.ts` parses `role` (`creator` or `admin`), but
  nothing reads it. `composition/session.ts` exports `getCurrentUser` from
  `auth.api.getSession({ headers })`.
- **The `twoFactor` plugin**, read in `node_modules/better-auth/dist/plugins/two-factor`:
  - Its sign-in hook matches only `/sign-in/email`, `/sign-in/username` and `/sign-in/phone-number`,
    so magic-link sign-ins are never challenged.
  - With `allowPasswordless: true`, `enableTwoFactor` needs no password. It returns `totpURI` and
    `backupCodes`, and stores the secret and the codes encrypted with the auth secret.
  - With a session, `verifyTOTP` and `verifyBackupCode` check the code. Their account lockout (10
    failures, 15 minutes) applies **only to sign-ins**, never to a call that has a session (found
    while applying; see Decision 3).
  - The first valid TOTP sets `twoFactorEnabled` and **rotates the session**: it creates a new
    session, sets its cookie and deletes the old one. No step-up marker is written.
- **`disabledPaths`** is enforced in Better Auth's HTTP router `onRequest` (`api/index.mjs`) and
  answers `404`. Server-side `auth.api.*` calls bypass it.
- **Private-route patterns.** `connection()` in the `studio`, `g` and `preview` layouts; the nonce
  mode list in `security/content-security-policy.ts`; route helpers in `http/api-response.ts`
  (`validateJsonMutationRequest`, `readJsonBody`, `createApiErrorResponse`); and the rate limiter
  `mongo-gift-rate-limiter.ts`, where a new scope needs the `apiRateLimits` validator enum.

The governing ADRs are ADR-0007 (Better Auth passwordless; this change adds the admin step-up),
ADR-0005 (route-specific CSP) and ADR-0001 (modular monolith; adapters wired in composition).

## Goals / Non-Goals

**Goals:**

- One guard used by every admin page and route, decided before any admin data access.
- A second factor that a stolen session cookie cannot bypass, re-enroll or disable.
- An audit trail that support can read and that can never leak gift content.

**Non-Goals:**

- Admin actions on gifts, templates, assets or orders (later changes).
- Changing creator sign-in in any way.

## Decisions

### 1. The `twoFactor` plugin for secrets, an own step-up for sessions

`composition/auth.ts` adds the plugin and disables its HTTP surface:

```ts
twoFactor({
  allowPasswordless: true,
  issuer: "LoveMemory",
  backupCodeOptions: { amount: 10 },
  schema: { twoFactor: { modelName: COLLECTIONS.twoFactors } },
}),
// …and at the top level of betterAuth({ … }):
disabledPaths: TWO_FACTOR_HTTP_PATHS,
```

`TWO_FACTOR_HTTP_PATHS` lists every endpoint the plugin registers:

- `/two-factor/enable`, `/two-factor/disable`;
- `/two-factor/get-totp-uri`, `/two-factor/verify-totp`;
- `/two-factor/send-otp`, `/two-factor/verify-otp`;
- `/two-factor/verify-backup-code`, `/two-factor/generate-backup-codes`.

A unit test compares the list with the plugin's endpoint paths, so a plugin upgrade that adds one
fails the test.

**Why the plugin.** It already provides RFC 6238 verification, encrypted storage, backup codes and
lockout, and it is pinned with `better-auth`. Writing TOTP ourselves would add security-critical
code and a dependency for no gain.

**Why our own step-up.** The plugin cannot challenge magic-link sign-ins, and it marks nothing on an
existing session. `adminStepUps` stores the step-up:

- `_id`: `sha256(session.id)`;
- `userId`;
- `verifiedAt`;
- `expiresAt`: `verifiedAt + 12 h` (TTL index).

The guard requires a document whose `_id` matches the current session, with the same `userId` and
an `expiresAt` later than now.

- **Sign-out.** Ending a session makes its step-up unreachable. The TTL index then removes it.
- **Revoke and reset.** `admin:revoke` and `admin:reset-mfa` also delete the user's step-ups
  explicitly.

**Alternative: Better Auth's `admin` plugin.** It adds its own `role`, ban and impersonation
endpoints. Rejected: impersonation is dangerous here, and the CLI-only grant (decision A3) would
have to fight its HTTP surface too.

### 2. Admin module and the guard

`apps/web/src/modules/admin/application/admin-access.ts` exports `resolveAdminAccess`. It takes
`{ session, stepUps, now }` and returns one of:

- `{ kind: "none" }`: no session, or the role is not `admin`;
- `{ kind: "needs-enrollment", user }`: an admin with `twoFactorEnabled` false;
- `{ kind: "needs-step-up", user }`: an admin with a factor but no valid step-up;
- `{ kind: "admin", user, sessionId }`.

The session port gives `{ user: { id, email, role, twoFactorEnabled }, session: { id } }`;
`session.ts` adds `twoFactorEnabled` (default `false`) to `CurrentUserSchema`.

Presentation helpers in `modules/admin/presentation/admin-guard.ts`:

- **`requireAdminPage()`** is used by every page except `/admin/mfa`:
  - `none` calls `notFound()`;
  - `needs-*` calls `redirect("/admin/mfa")`.
- **`requireAdminForMfa()`** is used by `/admin/mfa`: `none` calls `notFound()`.
- **`requireAdminRoute(request, { allowMfa })`** is used by every API route and returns a `Response`
  or the access:
  - `none` gives `404 NOT_FOUND`;
  - `needs-*` gives `403 FORBIDDEN` with `MFA_REQUIRED`, unless `allowMfa`.

`app/admin/layout.tsx` calls `connection()` and renders a minimal shell (`Quản trị`, links to
`/admin` and `/admin/audit`). It renders no admin data itself, and each page enforces its own guard.

Headers: `next.config.ts` gives `/admin` and `/admin/:path*` the headers `Cache-Control: no-store`
and `X-Robots-Tag: noindex`. Admin API responses already use `no-store` through
`createApiSuccessResponse`.

### 3. MFA routes

**`POST /api/admin/mfa/enroll`** runs these steps:

1. `validateJsonMutationRequest`.
2. `requireAdminRoute({ allowMfa: true })`.
3. `twoFactorEnabled`, which answers `409 MFA_ALREADY_ENABLED`.
4. `readJsonBody` with the strict schema `{}`.
5. `auth.api.enableTwoFactor({ headers, body: {} })`.
6. `201` with `{ totpUri, setupKey, backupCodes }`, where `setupKey` is the `secret` query
   parameter of the URI.

Nothing is logged except the request id on a failure.

Every admin route runs the admin guard **before** the media-type and origin checks, so a non-admin
gets the same `404` whatever the request looks like.

**`POST /api/admin/mfa/verify`** runs these steps:

1. The guards.
2. `requireAdminRoute({ allowMfa: true })`. An admin who has never enrolled still verifies here:
   the first valid TOTP enables the factor.
3. The `admin-mfa` rate limit, with the subject `user:{id}`.
4. The body `{ code: string(1..32) }`.
5. The plugin call:
   - a code of 6 digits uses `auth.api.verifyTOTP({ headers, body: { code } })`;
   - anything else uses `auth.api.verifyBackupCode({ headers, body: { code } })`.
6. The plugin's answer:
   - **Success.** Record the step-up and the audit event in one transaction, then answer `200`.
     When the plugin rotated the session (the first code), the step-up is recorded for the session
     in the new cookie, read back with `auth.api.getSession`, and the plugin's `Set-Cookie` values
     are forwarded on the response.
   - **A refusal** (the plugin's `400` or `401`) gives `400 VALIDATION_ERROR` with
     `fieldErrors.code` and records `admin.mfa.failed`.
7. **Lockout (our own).** Because the plugin's lockout skips calls with a session, the service
   keeps it in the same fields the plugin uses on its `twoFactors` record (`failedVerificationCount`,
   `lockedUntil`): an atomic increment per refused code, a 15-minute lock at the tenth consecutive
   one, and a reset on success. While locked, every code answers `429` with the remaining
   `retryAfterSeconds`, without being checked, and records `admin.mfa.failed` with reason `locked`.
   `admin:reset-mfa` deletes the record, and the lock with it.
8. **Backup codes before activation.** Until the factor is enabled, only a 6-digit authenticator
   code is accepted, so a pending backup code cannot stand in for the activation.

The event is `admin.mfa.enrolled` when `twoFactorEnabled` was false before the call, and
`admin.mfa.verified` otherwise.

### 4. Audit log

`modules/admin/application/audit.ts`:

- `AuditActionSchema` is a `z.enum` of the actions.
- `AuditRecordInput` holds `actor`, `action`, `target` and `metadata`. The metadata schema is a
  record of at most 10 keys of boolean, number or string up to 100 characters. Keys named like
  `email`, `code`, `token`, `shareId` or `password` are rejected by a refinement, as belt and
  braces.
- `createAuditService({ repository, clock })` builds `record(input, requestId)`, which fills `_id`,
  `at` and `expiresAt` (`at + 365 d`) and inserts the record.

`mongo-audit-log.ts` has:

- `insert(record, session?)`;
- `listLatest({ limit, targetId? })`, served by `audit_log_at` or `audit_log_target_at`.

There is no update or delete method. Audited operations with a database effect write the record in
the same transaction (the CLI and the step-up). Read audits (the lookup) are written before the page
renders the data, and a failed write fails the page (`500`) instead of showing unaudited data.

### 5. Gift lookup

`modules/admin/application/gift-lookup.ts` exports `lookupGift(query)`:

- **Normalization.** It trims the query and accepts at most 64 characters.
- **The query.** One `findOne` with
  `{ $or: [{ _id: q }, { publicId: q }, { shareId: { $eq: q, $type: "string" } }] }`. All three
  branches are indexed.
- **The owner.** The owner's email comes from `users` by `ownerId`.
- **Asset counts.** One aggregation, `assets` `$match { giftId }` then `$group` by `status`, served
  by `assets_gift_field_created`.
- **The DTO.** `AdminGiftSummary` holds exactly the fields of the spec. A snapshot test asserts that
  no other key exists.

The repository lives in `modules/admin/infrastructure`. It reads `gifts`, `users` and `assets`
directly, with admin-only, cross-owner queries; no creator repository gains a cross-owner method.

`app/admin/page.tsx` reads `?q=`. When it is present, the page records `admin.gift.looked_up` and
then renders the summary or `Không tìm thấy món quà nào.` The form uses `GET`, so the query stays in
the URL of an internal, `noindex`, `no-store` page only. Since `?q=` can hold a share id, the page
sets `Referrer-Policy: no-referrer` for `/admin` paths.

### 6. Operator commands

`scripts/admin.ts` takes `grant`, `revoke` or `reset-mfa`, `<email>` and `--operator <name>`.

- **Data access.** It uses the MongoDB client directly, because it is an operator tool, in one
  transaction per command:
  - `grant`: `users.updateOne({ email, role: { $ne: "admin" } }, { $set: { role: "admin" } })`, then
    the audit insert when the update modified the user;
  - `revoke`: the role update, `sessions.deleteMany({ userId })`,
    `adminStepUps.deleteMany({ userId })`, then the audit insert;
  - `reset-mfa`: `twoFactors.deleteMany({ userId })`,
    `users.updateOne({ $set: { twoFactorEnabled: false } })`, deleting the sessions and the
    step-ups, then the audit insert.
- **Stored ids (found while applying).** With `generateId: "uuid"`, Better Auth's Mongo adapter
  stores `users._id`, and every field that references a user (`sessions.userId`,
  `twoFactors.userId`), as BSON UUIDs, and hands the application their string form. The commands
  therefore:
  - use the stored `_id` for `users`, `sessions` and `twoFactors`;
  - use the string form for `adminStepUps` and the audit target.

  The lookup's owner query and the lockout match either form (`better-auth-ids.ts`).

- **Errors.** An unknown email is `User not found: <email>`.
- **Output.** One JSON line per command, holding the user id but never the email.
- **Scripts.** `package.json` gains `admin:grant`, `admin:revoke` and `admin:reset-mfa`.

### 7. Schema version `13`

- **New collections:**
  - `twoFactors`, with no validator (the plugin owns its shape) and the index
    `two_factors_user_unique`;
  - `adminStepUps`, with its validator and the indexes `admin_step_ups_user` and the TTL index;
  - `auditLog`, with its validator and the indexes `audit_log_at`, `audit_log_target_at` and the TTL
    index.
- **Rate-limit scope.** `apiRateLimits` gains the scope `admin-mfa`.
- **No backfill.** Users without `twoFactorEnabled` read as `false`.

Better Auth's Mongo adapter writes `twoFactorEnabled` to `users`, whose collection has no validator.

## Risks / Trade-offs

- **Admin account compromise.**
  - A stolen session cookie alone gets only the MFA page, and cannot enroll or disable a factor
    (the HTTP paths are disabled, and enrollment is refused once enabled).
  - A stolen device still needs the session. Lockout and the per-user rate limit bound guessing.
  - The risk register gains the row "Admin account compromise". The runbook covers revocation and
    reset.
- **A plugin upgrade adds a two-factor HTTP path.** → The path-list test fails until the list is
  updated.
- **Losing the device and the backup codes** locks the admin out. → `admin:reset-mfa` by an
  operator. The runbook requires identity confirmation outside email.
- **Audit volume.** Every lookup and every step-up is a record. At MVP scale this is negligible, and
  the TTL index caps growth.
- **Rollback past schema version 13.** The previous build ignores the new collections and the
  `twoFactorEnabled` field. Its `db:verify` reports drift. No data repair is needed; admins step up
  again after the roll forward.

## Migration Plan

1. Merge to `dev` and deploy. Run `pnpm db:migrate` and `pnpm db:verify`.
2. Grant the first admin: `pnpm admin:grant <email> --operator <name>` against the tier's database.
3. That admin signs in, enrolls at `/admin/mfa`, and stores the backup codes.
4. Smoke test:
   - a lookup by `publicId` shows the summary, and the audit page lists the lookup;
   - a creator gets `404` on `/admin`;
   - `POST /api/auth/two-factor/enable` answers `404`.
5. Promote to `stg` with the same steps and a separate admin grant per tier.
