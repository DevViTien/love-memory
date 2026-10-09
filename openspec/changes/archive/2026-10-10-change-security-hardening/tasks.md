# Tasks

## 1. Pre-apply checks

- [x] 1.1 Confirm this is the only active change, `DATABASE_SCHEMA_VERSION` is `15`, and the ESLint
      allowlist names the two rate-limiter imports. Re-diff each MODIFIED block. Verify that
      `validate --strict` and `pnpm spec:check` pass with the two waivers.

## 2. Limiter as a port (D2, D18)

- [x] 2.1 Move the limiter to `modules/rate-limits` (port, subjects, Mongo adapter), add
      `composition/rate-limits.ts`, and rewire every caller. Route the anonymous draft cookie helpers
      through `composition/anonymous-draft.ts`, and empty the ESLint allowlist. Verify:
  - the moved limiter tests pass;
  - new tests cover `consumeAll` and `createMongoRateLimiter`;
  - the updated route tests no longer pass the secret;
  - `pnpm lint` passes with no allowlist.

## 3. Coverage

- [x] 3.1 Add the `gift-read`, `media-read`, `media-write` and `admin-action` limits (design
      Decision 3). Verify:
  - the admin route tests answer `429` before any change;
  - the media and gift route suites still pass.
- [x] 3.2 Bring the database to schema version 16 with the four scopes. Verify migration tests for
      the scopes, "Database not yet migrated to version 16" and the mismatch message.
- [x] 3.3 Add the three headers. Verify the `next-config` test.
- [x] 3.4 Add the Resend and Trigger.dev patterns to the secret scan, and skip deleted files. Verify
      `pnpm test:secrets` passes, a sample key matches, and the `re_playwright_…` placeholder does not.

## 4. Access control and operations

- [x] 4.1 Add `e2e/access-control.spec.ts` (design Decision 5). Verify that it passes on both
      projects.
- [x] 4.2 Write `docs/runbooks/credential-rotation.md` (with the session and cookie review) and
      `docs/runbooks/backup-and-restore.md`. Then update:
  - the deployment runbook: schema version 16, the Vercel Firewall rules for D1, and links;
  - `docs/architecture.md`: the limiter port and the coverage table;
  - the risk register: a row for missing backups;
  - `docs/sprints/sprint-3-review.md`: D1, D2 and D18 marked resolved by this change.

- [x] 4.3 Make the privacy notice state that backups holding a deleted gift expire within 7 days
      (it promised erasure within 24 hours, while snapshots keep data 7 days). Verify the notice test.

## 5. Verification and archive

- [x] 5.1 Run `pnpm verify:local` and verify that it passes. Record any part that cannot run locally.

  **Run 2026-10-10.**
  - The first run stopped at `format:check` on `eslint.config.mjs`, after the allowlist removal; it
    was formatted.
  - The rerun passed in full:
    - the secret scan (now with the Resend and Trigger.dev patterns), `spec:check` (with the two
      waivers), format, lint with no allowlist, and types;
    - coverage: 1899 tests, 96.6% statements;
    - `pnpm audit` and the build;
    - `test:e2e:chrome`: 45 of 45, `access-control.spec.ts` included.

- [x] 5.2 Archive with `pnpm openspec archive change-security-hardening --yes` after diffing each
      MODIFIED block, remove the two waivers, and verify `pnpm spec:check` passes.

## Out of scope

- In-app page-render limits with a designed `429` page (Vercel Firewall covers D1).
- `__Host-` cookie prefixes.
- Running a real restore drill (Sprint 7, plan.md §16.4).
