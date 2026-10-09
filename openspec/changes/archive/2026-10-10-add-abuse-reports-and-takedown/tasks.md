# Tasks

## 1. Pre-apply checks

- [x] 1.1 Confirm the starting point:
  - this is the only active change;
  - `DATABASE_SCHEMA_VERSION` is `14`;
  - `abuseReports` is reserved and unmanaged.

  Re-diff each MODIFIED block against `openspec/specs/`. Verify that `validate --strict` and
  `pnpm spec:check` pass with this change's two waivers.

## 2. Domain and schema

- [x] 2.1 Add `takedown` to `GiftSchema`. Verify schema tests: a valid takedown, and one with an
      unknown `by` refused.
- [x] 2.2 Bring `packages/database` to schema version 15 (design Decision 5). Verify
      `migrations.test.ts` covers:
  - the `abuseReports` validator and indexes, and no longer reserved;
  - the scopes;
  - "Database not yet migrated to version 15";
  - the version-15 mismatch message.

## 3. Reports

- [x] 3.1 Add `modules/moderation/application/abuse-reports.ts` and the Mongo report insert, with the
      emergency takedown and its `gift.taken_down` record in one transaction. Verify tests:
  - each category's severity;
  - the stored fields (no share id);
  - critical versus non-critical;
  - a gift already taken down;
  - the request schema limits.
- [x] 3.2 Add `findLiveGiftId` to the public gift service, the two rate-limit scopes, and
      `POST /api/reports`. Verify route tests:
  - `202` and the stored report;
  - an automated user agent stores nothing;
  - `404` for a link that does not open;
  - `429` from either limit;
  - a body over 4096 bytes or with an unknown key answers `400` or `413`;
  - no details in the logs.
- [x] 3.3 Add the report form to the recipient page (`ReportGiftForm` in `PublicGiftScreen`).
      Verify component tests: the categories, the success and error states, and the details limit.

## 4. Takedown on the owner side

- [x] 4.1 Refuse resume while taken down (service and filter), return `takenDown` from
      `findPaused`, and show the takedown notice in `PausedGiftPanel`. Verify the lifecycle service,
      repository and component tests.

## 5. Admin

- [x] 5.1 Add `moderation.ts` (`listQueue`, `act`, `review`) with its Mongo adapter (design
      Decision 4). Verify tests:
  - the queue order and the counts;
  - each action's writes and audit in one transaction;
  - `REPORT_CLOSED`, `NOT_TAKEN_DOWN`, `GIFT_GONE` and not-found;
  - restore of an expired gift staying paused;
  - the review records `admin.gift.content_viewed` before loading content.
- [x] 5.2 Add `/admin/reports`, `/admin/reports/[reportId]`, `POST /api/admin/reports/[reportId]`,
      the row actions and the `Báo cáo` link. Verify route tests (guard, `404`, `409`, `200`) and
      component tests for the queue rows, the actions and the review rendering.

## 6. Documentation

- [x] 6.1 Update:
  - `docs/runbooks/admin-access.md`: a "Reports and takedown" section with the emergency flow, the
    review, takedown and restore;
  - `docs/architecture.md`: "Abuse reports and takedown", plus the schema version 15 rollout;
  - the deployment runbook entry for version 15;
  - the risk register: "Free publishing is open on Production before takedown exists" mitigated
    pending the `stg` check, and a new row "False emergency reports".

## 7. End-to-end and migration check

- [x] 7.1 Add `apps/web/e2e/abuse-reports.spec.ts`. An owner publishes a Free gift, then:
  1. a recipient (another context) reports it as `harassment`, and sees the thanks;
  2. a stepped-up admin sees the report in `/admin/reports`, opens the review page (the gift's text
     is shown, and the audit holds `admin.gift.content_viewed`), and takes the gift down;
  3. the link is not-found, and the owner's Studio shows `Món quà đã bị tạm khoá`;
  4. the admin restores, and the link opens again.

  A second test: a `child_safety` report makes the link not-found at once. Verify that
  `pnpm test:e2e` passes.

- [x] 7.2 Run against a throwaway database (`MONGODB_DATABASE=love_memory_v15_check`):
  1. migrate from version 14, and verify;
  2. migrate again;
  3. drop the database.

  Record the run here.

  **Run 2026-10-10** (`love_memory_v15_check`, dropped afterwards; no tier database touched):
  - `db:migrate` built version 15. The version-14 shape was then restored by hand
    (`abuseReports` dropped, the two report scopes removed from the `apiRateLimits` validator,
    ledger `14`).
  - `db:verify` failed with `MongoDB validator mismatch: apiRateLimits`. `db:migrate` and
    `db:verify` then passed, and a second migrate and verify passed too.
  - The ledger reads `15`. `abuseReports` has `abuse_reports_queue`, `abuse_reports_gift_status`
    and `abuse_reports_expiry_ttl`.

## 8. Verification and archive

- [x] 8.1 Run `pnpm verify:local` and verify that it passes. Record any part that cannot run locally.

  **Run 2026-10-10.**
  - The first run failed one per-file coverage gate: `abuse-reports.ts` reached 50% function
    coverage, because the default clock and id generator were never run. A test of the defaults
    was added.
  - The rerun passed in full:
    - the secret scan, `spec:check` (with the two waivers), format, lint and types;
    - coverage: 1878 tests, 96.6% statements;
    - `pnpm audit` and the build;
    - `test:e2e:chrome`: 42 of 42.

- [x] 8.2 Archive with `pnpm openspec archive add-abuse-reports-and-takedown --yes`, after diffing
      each MODIFIED block. Then:
  - remove the two waivers;
  - check the Purpose of `abuse-reports`.

  Verify `pnpm spec:check` passes.

## Out of scope

- Takedown emails to the owner and to reporters (Sprint 5 `add-system-emails`).
- A captcha, account bans, appeals, and exporting reports.
