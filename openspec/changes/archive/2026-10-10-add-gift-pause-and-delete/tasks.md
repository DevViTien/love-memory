# Tasks

## 1. Pre-apply checks

- [x] 1.1 Confirm the starting point:
  - this is the only active change;
  - `DATABASE_SCHEMA_VERSION` is `13`;
  - nothing writes `paused`, `deleting` or `deleted`.

  Re-diff each MODIFIED block against `openspec/specs/`. Verify that `validate --strict` and
  `pnpm spec:check` pass with this change's two waivers.

## 2. Domain and schema

- [x] 2.1 Add `pausedAt` and `deletionRequestedAt` to `GiftSchema`, with the `paused` refinement
      (design Decision 1). Verify schema tests:
  - a paused gift needs the publication fields;
  - a deleting draft is valid;
  - the existing transitions are unchanged.
- [x] 2.2 Bring `packages/database` to schema version 14 (design Decision 6):
  - add `giftTombstones` to `COLLECTIONS`;
  - the `gift-lifecycle` scope;
  - the `analytics_events_gift_ref` index.

  Verify `migrations.test.ts` covers:
  - the new collection, validator and indexes;
  - the scope;
  - "Database not yet migrated to version 14";
  - the version-14 mismatch message.

## 3. Pause, resume and delete requests

- [x] 3.1 Add the repository writes `pause`, `resume` and `requestDeletion` (with the job enqueued
      in the transaction), and the service methods (design Decision 2). Verify service tests for every
      row of the decision table, including:
  - an anonymous accessor deleting a draft but not a published gift;
  - the repeated delete returning the stored time;
  - an expired resume.

  Verify repository tests for:
  - the conditional filters;
  - the transaction and the deduplication key.

- [x] 3.2 Add the `gift-lifecycle` rate-limit scope and the three routes. Verify route tests:
  - `200`, `202`, `404` and `409` with their reasons;
  - a foreign origin is refused;
  - a non-empty body answers `400`;
  - the rate limit answers `429` before the service runs.

## 4. Deletion job

- [x] 4.1 Add `gift.delete.v1` with its ports (design Decision 3), and register it in
      `composition/jobs.ts`. Verify handler tests:
  - a full purge in order;
  - the no-op for a gift that is not deleting;
  - a storage failure that retries without a tombstone;
  - a repeated run;
  - the audit metadata and tombstone fields hold no content.

  Verify adapter tests for:
  - the asset moves;
  - the derived-record deletes (excluding the running job);
  - the analytics delete by `giftRef`;
  - the purge transaction.

## 5. Studio and admin

- [x] 5.1 Add the paused view (`findPaused`, design Decision 4). Add `PausedGiftPanel`, `Tạm dừng chia sẻ` in
      `PublishedPanel`, `GiftDeleteButton` and the `/studio/deleted` page. Verify component tests for:
  - the paused, expired-paused and published states;
  - the confirmation text, and a declined confirmation;
  - the request sent, and the error message.
- [x] 5.2 Add the tombstone fallback of the admin lookup and its view (design Decision 5). Verify
      tests for the tombstone match, its exact DTO keys, and the audit target.

## 6. Documentation

- [x] 6.1 Update:
  - `docs/architecture.md`: "Gift lifecycle", covering pause, delete, the purge job and tombstones,
    plus the schema version 14 rollout and rollback;
  - `docs/runbooks/background-jobs.md`: the `gift.delete.v1` row and what to do with a dead one;
  - the deployment runbook entry for version 14;
  - `docs/runbooks/admin-access.md`: lookup of deleted gifts;
  - the risk register: close "Published share links cannot be revoked", and add "Deletion leaves
    content behind".

## 7. End-to-end and persistence check

- [x] 7.1 Add `apps/web/e2e/gift-lifecycle.spec.ts`. An owner publishes a Free gift (existing
      journey helpers), then:
  1. pauses it, and the share link shows not-found;
  2. resumes it, and the link opens;
  3. deletes it: the Studio shows `Đã xoá món quà.`, the link is not-found, and after the inline job
     run no gift, publication or asset object remains and a tombstone exists.

  Also verify that deleting an anonymous draft works from its browser. Verify that `pnpm test:e2e`
  passes.

- [x] 7.2 Run against a throwaway database (`MONGODB_DATABASE=love_memory_v14_check`), then drop it:
  1. migrate from version 13, and verify;
  2. migrate again.

  Record the run here.

  **Run 2026-10-10** (`love_memory_v14_check`, dropped afterwards; no tier database touched):
  - `db:migrate` built version 14. The version-13 shape was then restored by hand
    (`giftTombstones` dropped, `analytics_events_gift_ref` dropped, `gift-lifecycle` removed from
    the `apiRateLimits` validator, ledger `13`).
  - `db:verify` failed with `MongoDB validator mismatch: apiRateLimits`. `db:migrate` and
    `db:verify` then passed, and a second migrate and verify passed too.
  - The ledger reads `14`. `giftTombstones` has `gift_tombstones_public_id` and
    `gift_tombstones_expiry_ttl`, and `analyticsEvents` has `analytics_events_gift_ref`.

## 8. Verification and archive

- [x] 8.1 Run `pnpm verify:local` and verify that it passes. Record any part that cannot run locally.

  **Run 2026-10-10:** passed in full:
  - the secret scan, `spec:check` (with the two waivers), format, lint and types;
  - coverage: 1829 tests, 96.6% statements;
  - `pnpm audit` and the build;
  - `test:e2e:chrome`: 40 of 40.

  The Studio streams its not-found page (`loading.tsx`) with HTTP 200, so the E2E checks its
  heading. The spec requires only that the not-found page is rendered.

- [x] 8.2 Archive with `pnpm openspec archive add-gift-pause-and-delete --yes`, after diffing each
      MODIFIED block. Then:
  - remove the two waivers;
  - check the Purpose of `gift-lifecycle`.

  Verify `pnpm spec:check` passes.

## Out of scope

- Admin pause and takedown (change 5), and owner notification emails (Sprint 5).
- An owner dashboard; account deletion.
- Automatic deletion after expiry (`gift.expire`, change 6).
- Editing a paused gift; undoing a delete.
