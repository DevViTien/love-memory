# Tasks

## 1. Pre-apply checks

- [x] 1.1 Confirm the starting point:
  - `pnpm openspec list` shows this change as the only active change;
  - `DATABASE_SCHEMA_VERSION` is `12`;
  - `better-auth` is still `1.7.5`, and its `two-factor` plugin's sign-in hook matches only the password sign-in paths;
  - `session.ts` has the `role` enum, and nothing reads it.

  Re-diff each MODIFIED block against `openspec/specs/`. Verify that `pnpm openspec validate add-admin-access-and-audit --strict` and `pnpm spec:check` pass with this change's one waiver.

## 2. Audit log

- [x] 2.1 Add `modules/admin/application/audit.ts` (`AuditActionSchema`, the metadata schema with its forbidden-key refinement, `createAuditService`) and `modules/admin/infrastructure/mongo-audit-log.ts` (`insert`, `listLatest`). Verify unit tests cover:
  - `expiresAt` 365 days after `at`;
  - metadata limits and forbidden keys refused;
  - the insert shape;
  - both list queries and their sort and limit;
  - that no update or delete method exists.

## 3. Admin access

- [x] 3.1 Add the `twoFactor` plugin and `disabledPaths` to `composition/auth.ts` (design Decision 1), and `twoFactorEnabled` to `CurrentUserSchema`. Verify:
  - a test asserts that `TWO_FACTOR_HTTP_PATHS` equals the plugin's registered endpoint paths;
  - a session test reads `twoFactorEnabled` with a default of `false`.
- [x] 3.2 Add `modules/admin/application/admin-access.ts` (`resolveAdminAccess`) and the step-up repository (`mongo-admin-step-ups.ts`). Verify unit tests cover every outcome:
  - no session, a creator, an admin without a factor, an admin without a step-up;
  - an expired step-up, a step-up of another session, and a valid step-up.
- [x] 3.3 Add the guard helpers (`requireAdminPage`, `requireAdminForMfa`, `requireAdminRoute`), the `/admin` layout with `connection()`, and the headers in `next.config.ts`. Make `/admin` a nonce CSP route in `security/content-security-policy.ts`. Verify:
  - guard unit tests for `notFound`, redirect, `404` and `403 MFA_REQUIRED`;
  - the CSP test "Admin pages use the nonce policy", including `/administration-guide` staying static;
  - a `next.config` test for the `/admin` headers.

## 4. MFA routes and page

- [x] 4.1 Add `POST /api/admin/mfa/enroll` (design Decision 3). Verify route tests:
  - "First enrollment" returns `totpUri`, `setupKey` and `backupCodes`;
  - "Re-enrollment refused" answers `409 MFA_ALREADY_ENABLED`;
  - "Creator cannot enroll" answers `404`;
  - a foreign origin is refused with `403`.
- [x] 4.2 Add the `admin-mfa` rate-limit scope and `POST /api/admin/mfa/verify`. Verify route tests:
  - "Step-up with a TOTP code" records the step-up and `admin.mfa.verified`;
  - the first code records `admin.mfa.enrolled`;
  - "Wrong code" answers `400` with `fieldErrors.code` and records `admin.mfa.failed`;
  - a backup code is routed to `verifyBackupCode`;
  - the lockout (our own, design Decision 3) answers `429`;
  - "Admin step-up attempts limited" answers `429` before any check;
  - no code value appears in the logs or the audit.
- [x] 4.3 Add `app/admin/mfa/page.tsx` and its client form: the enrollment step showing the setup key, the URI and the backup codes with the safety note, then the code form. Verify component tests for both states and the error messages.

## 5. Lookup and audit pages

- [x] 5.1 Add `modules/admin/application/gift-lookup.ts` and `modules/admin/infrastructure/mongo-admin-gift-lookup.ts` (design Decision 5). Verify unit tests:
  - the `$or` query;
  - the owner email and the anonymous label;
  - the asset counts;
  - a snapshot of the exact DTO keys (no content, asset ids or share links).
- [x] 5.2 Add `app/admin/page.tsx` (`Tìm món quà`, the summary, `Không tìm thấy món quà nào.`) with the audit before the render. Verify tests for "Lookup by public id", "Lookup by share id is not leaked" (the audit holds the gift id, not the query) and "Nothing found".
- [x] 5.3 Add `app/admin/audit/page.tsx` with `?target=`. Verify tests for "Latest records", "Records of one gift" and the `Asia/Ho_Chi_Minh` time format.

## 6. Schema version 13 and commands

- [x] 6.1 In `packages/database`:
  - add `twoFactors`, `adminStepUps` and `auditLog` to `COLLECTIONS` and to the migration definitions, with validators and indexes;
  - add `admin-mfa` to the `apiRateLimits` scope enum;
  - set `DATABASE_SCHEMA_VERSION` to `13`.

  Verify that `migrations.test.ts` covers:
  - the new collections, validators and indexes, and the TTL indexes;
  - the scope;
  - "Database not yet migrated to version 13";
  - the version-13 mismatch message.

- [x] 6.2 Add `scripts/admin.ts` and the `admin:grant`, `admin:revoke` and `admin:reset-mfa` scripts (design Decision 6). Verify a unit test of the command module covers:
  - the transactions and audit records;
  - "Unknown email" and "Missing operator name";
  - the no-op cases.
- [x] 6.3 Run in a throwaway database (`MONGODB_DATABASE=love_memory_v13_check`), then drop it:
  1. migrate from version 12, verify, and migrate again;
  2. `admin:grant`, `admin:reset-mfa` and `admin:revoke` on a seeded user;
  3. read back the audit records.

  Verify:
  - the ledger reads `13`;
  - a grant then revoke leaves no session;
  - the audit holds `admin.role.granted`, `admin.mfa.reset` and `admin.role.revoked` with actor `operator`.

  Record the run here.

  **Run 2026-10-09** (`love_memory_v13_check` on the dev cluster, dropped afterwards; no tier
  database touched):
  - `db:migrate` built version 13. The version-12 shape was then restored by hand (the three new
    collections dropped, `admin-mfa` removed from the `apiRateLimits` validator, ledger `12`).
  - `db:verify` failed with `MongoDB validator mismatch: apiRateLimits`. `db:migrate` then
    succeeded; `db:verify` passed; a second migrate and verify also passed. The ledger reads `13`.
  - A seeded creator with one session went through these commands, a fresh session added before
    each change:
    - `admin:grant`: changed;
    - `admin:reset-mfa`: changed;
    - `admin:grant` again: unchanged, nothing recorded;
    - `admin:revoke`: changed;
    - `admin:revoke` again: unchanged.

    The user ended as a `creator` with `twoFactorEnabled: false` and `0` sessions.

  - The audit holds exactly `admin.role.granted`, `admin.mfa.reset` and `admin.role.revoked`, each
    with actor `{ kind: "operator", id: "lan" }`, the user id as target, and `requestId: null`.
  - `admin:grant nobody@example.test` exited `1` with `User not found: nobody@example.test`. A grant
    without `--operator` exited `1` (`Missing operator name`), and the role was unchanged.
  - **Rerun after the E2E found the UUID ids** (Better Auth stores user ids, and `sessions.userId`
    and `twoFactors.userId`, as BSON UUIDs; see design Decision 6). The rerun used a fresh
    `love_memory_v13_check`, dropped afterwards, and a seeded user with a UUID `_id`, UUID
    `sessions.userId` and UUID `twoFactors.userId`.
    - `admin:grant`: changed.
    - `admin:reset-mfa`: left `0` factors, `0` sessions and `0` step-ups.
    - `admin:revoke`: left `0` sessions and `0` step-ups. The factor is kept, as designed.
    - Every audit target id was the string form `11111111-1111-4111-8111-111111111111`.

## 7. Documentation

- [x] 7.1 Write `docs/runbooks/admin-access.md`, covering:
  - granting the first admin per tier;
  - enrollment and backup codes;
  - a lost device (identity check outside email, then `admin:reset-mfa`);
  - revocation;
  - reading the audit page.

  Add a note to ADR-0007 (the passwordless admin step-up), the "Admin access and audit" section in `docs/architecture.md`, the deployment runbook entry for schema version `13`, and the risk-register row "Admin account compromise".

## 8. End-to-end

- [x] 8.1 Add `apps/web/e2e/admin.spec.ts`. The flow: a user signs in by magic link, the test grants the role in the E2E database, then:
  1. `/admin` redirects to `/admin/mfa`;
  2. enrollment shows the setup key, and a code computed from it by a test RFC 6238 helper is submitted;
  3. `/admin` loads, a lookup by `publicId` shows the summary without gift text, and `/admin/audit` lists the lookup.

  Also verify:
  - a creator and a signed-out browser get `404` on `/admin`;
  - `POST /api/auth/two-factor/enable` answers `404`.

  Verify that `pnpm test:e2e` passes.

## 9. Verification and archive

- [x] 9.1 Run `pnpm verify:local` and verify that it passes. Record any part that cannot run locally.

  **Run 2026-10-09:**
  - These stages passed: the secret scan, `spec:check` (with this change's one waiver), format,
    lint, types, coverage (1751 tests, 96.6% statements), `pnpm audit` and the build.
  - In `test:e2e:chrome`, 35 of 36 passed. The admin journey failed once: `/auth/sign-in` answered
    the error page after `MongoServerSelectionError: Server selection timed out after 5000 ms`,
    before any admin code ran, so the cause was Atlas connectivity, not a code failure.
  - A full rerun of `pnpm test:e2e:chrome` passed 36 of 36. `admin.spec.ts` also passed on
    `chromium` and `mobile-chromium` (4 of 4).

- [x] 9.2 Archive with `pnpm openspec archive add-admin-access-and-audit --yes`, after diffing each MODIFIED block. Then:
  - remove the waiver;
  - check the Purposes of `admin-access` and `audit-log`.

  Verify `pnpm spec:check` passes.

## Out of scope

- Admin actions: pause, takedown, delete, the template kill switch, asset retry, dead-job and order views (later changes).
- Granular permissions, organizations, impersonation.
- MFA for creators, passkeys, email OTP, trusted devices.
- A QR image for enrollment (Sprint 4 QR work).
- Searching gift content; exporting audit logs.
