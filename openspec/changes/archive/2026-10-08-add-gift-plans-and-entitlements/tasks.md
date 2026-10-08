# Tasks

## 1. Pre-apply checks

- [x] 1.1 Confirm the starting point before writing code:
  - `pnpm openspec list` shows this change as the only active change;
  - `DATABASE_SCHEMA_VERSION` is still `10`;
  - the code still has every symbol that design Context names: `PublishEntitlement`, `getInternalPublishEnvironment`, `findPublishedByShareId`, `listImageFieldReferences`, and the fingerprint `JSON.stringify(["publish", …])`.

  Re-diff each MODIFIED block against the then-current `openspec/specs/`. Verify that `pnpm openspec validate add-gift-plans-and-entitlements --strict` and `pnpm spec:check` pass, with the three `modifiedBodyDrop` waivers of this change in `openspec/gate-exceptions.json`.

- [x] 1.2 Write `docs/sprints/sprint-5-plan.md`, covering:
  - the Product Owner decisions of 2026-10-08 (plans, pay once per gift, Sprint 5 before the rest of Sprint 4, a fake provider first);
  - the five planned changes in dependency order;
  - the Sprint 4 dependencies that are out of scope;
  - the debt items that each change absorbs.

  Verify it links this change and plan.md §14.

## 2. Domain

- [x] 2.1 Add `packages/domain/src/billing/plan.ts` with:
  - `PLAN_IDS`, `PlanIdSchema`, `PlanSchema` (strict);
  - a frozen `PLAN_CATALOG` holding `free@1` and `standard@1`;
  - `currentPlan(planId)`.

  Export them from the domain index. Verify `plan.test.ts`:
  - pins every value of the `gift-plans` table;
  - shows that `currentPlan` returns the highest version, using a test-local catalog;
  - rejects an unknown plan id.

- [x] 2.2 Add `billing/gift-entitlement.ts` with `GiftEntitlementSchema` (strict; `source` is `free`, `internal` or `legacy`) and `grantEntitlement(plan, source, now)`. It returns `{ entitlement, expiresAt }`. Verify `gift-entitlement.test.ts`:
  - the Free grant at `2026-10-08T10:00:00Z` expires at `2026-10-22T10:00:00Z`;
  - the Standard grant expires 365 days later;
  - the snapshot copies every plan field.
- [x] 2.3 Extend `GiftSchema` with the optional `entitlement` and `expiresAt` and the refinement of design Decision 2. Give `publishGiftDraft` an `entitlement` input; `republishGift` carries both fields unchanged. Verify `gift-schema.test.ts` and `gift-publication.test.ts`:
  - a published gift without an entitlement is rejected;
  - a draft with one is rejected;
  - a mismatched `expiresAt` is rejected;
  - a first publish sets both fields;
  - a republish keeps both fields.

## 3. Template SDK and contracts

- [x] 3.1 Add `countImageItems(manifest, content)` to `packages/template-sdk/src/payload.ts`. It counts items across image fields and skips malformed items as `listImageFieldReferences` does. Verify the cases of 0, 5, and two image fields, plus a malformed item.
- [x] 3.2 In `packages/contracts/src/gift.ts`:
  - `PublishGiftRequestSchema` gains `planId`;
  - `GiftPublicationDtoSchema` gains `planId` and `expiresAt`;
  - `GiftPublicationSummarySchema` gains `planId`, `maxPhotos`, `watermark` and `expiresAt`;
  - add `PlanOfferDtoSchema` (the plan fields plus `available` and `internalGrant`).

  Verify that `gift.test.ts` accepts the new shapes and rejects:
  - a missing or unknown `planId`;
  - extra keys;
  - a summary with `source` or `priceVnd`.

## 4. Database schema version 11

- [x] 4.1 In `packages/database/src/migrations.ts`:
  - add `entitlement` and `expiresAt` to the `gifts` validator;
  - add `backfillLegacyEntitlements` after `backfillPublishedRevisions` (design Decision 10), building the snapshot from `PLAN_CATALOG`;
  - set `DATABASE_SCHEMA_VERSION` to `11`.

  Verify that `migrations.test.ts` covers:
  - the validator;
  - the backfill filter and pipeline: it matches only `published` gifts without an entitlement, `grantedAt` is `$publishedAt`, `$dateAdd` adds 365 days, and a second run is a no-op;
  - `MongoDB schema version mismatch: expected 11, received 1.`;
  - "Database not yet migrated to version 11".

- [x] 4.2 Run the migration in a throwaway database on a replica set, then drop the database. Use `MONGODB_DATABASE=love_memory_v11_check`. Seed the version-10 state:
  - a published gift without an entitlement (`publishedAt` `2026-10-01`);
  - a published gift with a `free` entitlement;
  - a draft.

  Then run `pnpm db:migrate`, `pnpm db:verify` and `pnpm db:migrate` again. Verify:
  - both migrate runs succeed and the ledger reads `11`;
  - the backfill gives the first gift the values of the "Legacy published gifts receive an entitlement" scenario;
  - the other two gifts are unchanged.

  Record the run in the PR.

- [x] 4.3 Add "Rolling back past schema version 11 (plans and entitlements)" to `docs/runbooks/preview-deploy-and-rollback.md` (design Risks). Also document there:
  - the rename of `INTERNAL_PUBLISH_ENABLED` to `INTERNAL_PLAN_GRANT_ENABLED` on each tier;
  - that `db:migrate` runs as soon as the deployment is `Ready`.

  Verify the section names `entitlement`, `expiresAt`, the Production consequence and the preferred roll-forward.

## 5. Persistence

- [x] 5.1 In `mongo-gift-repository.ts`, make `publish`:
  - `$set` `entitlement` and `expiresAt` on a first publish;
  - add `expiresAt: { $gt: now }` to the update filter.

  `toDomain` reads both fields. Verify that `mongo-gift-repository.test.ts` asserts both filters and both `$set` shapes.

- [x] 5.2 Make `findPublishedByShareId(shareId, now)` filter on `expiresAt: { $gt: now }`. Verify a repository test for the filter, then extend `scripts/verify-gift-persistence.ts` (`db:verify-gifts`) with:
  - the granted `free` entitlement and `expiresAt` after the first publish;
  - the entitlement unchanged after the update;
  - the share-id lookup at `expiresAt + 1 ms` finding nothing;
  - an update write conditioned on a time after `expiresAt` being rejected;
  - the `explain` of the share-id lookup still on `gifts_share_id_unique`.

  Run it against the local replica set at version `11`. Verify it prints `Gift persistence verification completed successfully.` and leaves no residue.

## 6. Configuration and services

- [x] 6.1 Rename `config/internal-publish.ts` to `config/internal-plan-grant.ts` (`INTERNAL_PLAN_GRANT_ENABLED`), with its test. Update `.env.example` and `playwright.config.ts`. Verify that the test covers:
  - `true`;
  - absent;
  - `yes`;
  - `true` with `VERCEL_ENV=production`.
- [x] 6.2 Replace `PublishEntitlement` with `PlanGrantPolicy` (design Decision 4) and wire it in `composition/gifts.ts`. Add the checks of design Decision 5 to `publishGift`:
  - the expiry check (update only);
  - the plan check;
  - the photo limit after the content issues;
  - `planId` in the fingerprint;
  - the entitlement grant through `publishGiftDraft`;
  - `GIFT_EXPIRED` on the `stale` path.

  Map the new codes in `gift-route-helpers.ts`, and give `toPublicationDto` and `toPublicationSummary` the plan fields. Verify that `gift-service.test.ts` and `publish-route-handler.test.ts` cover every new or changed scenario of the `gift-publishing` and `gift-plans` deltas:
  - "Missing or unknown plan" and "Plan refusal hidden from non-owners";
  - "Paid plan not available", "Too many photos for the Free plan", "Update over the entitlement's photo limit", "Plan change on update refused" and "Update of an expired gift";
  - "Expiry reached during an update";
  - "Replay with a different body" (another plan) and "Retry with another plan after a refusal";
  - "Free entitlement granted", "Update keeps the entitlement", "Free in Production" and "Grant on outside Production".

- [x] 6.3 Make the draft DTO's `publication` carry `planId`, `maxPhotos`, `watermark` and `expiresAt`. Verify the `gift-drafts` scenario "Entitlement in the summary" in the service and route tests.
- [x] 6.4 In `public-gift-service.ts`, pass `now` to the lookup and return `watermark` from `resolvePublicGiftPage`. Verify that `public-gift-service.test.ts` covers:
  - "Expired gift" for the page and the payload;
  - "Free link expires after 14 days" and "Last moment before expiry" (clock at `expiresAt` and at `expiresAt - 1 s`);
  - the watermark value for both plans.

## 7. Public page

- [x] 7.1 Change the `/g` not-found copy to `Món quà không tồn tại, đã hết hạn hoặc đã được thu hồi.` Pass `watermark` from the page to `PublicGiftScreen`, and render the host-level mark of design Decision 8. Verify `public-gift-screen.test.tsx`:
  - the mark is present for `watermark: true` and absent for `false`;
  - it is `pointer-events-none`;
  - it is outside the viewer's iframe.

## 8. Studio

- [x] 8.1 Build the plan offers on the Studio page from `PLAN_CATALOG` and `PlanGrantPolicy`, and pass them through `DraftEditor` into the Studio context in place of `publishEnabled`. Add `plan-choice.tsx`. Verify `plan-choice.test.tsx`:
  - the descriptions (`Miễn phí`, `49.000đ`, `Tối đa 3 ảnh`, `Tất cả ảnh mẫu quà cho phép`, `1 năm`);
  - both disabled explanations;
  - the internal-grant note;
  - default selection and selection following the photo count.
- [x] 8.2 Update `publish-step.tsx` and `publish-action.ts`:
  - the new disabled cases and confirmation line;
  - `planId` in the body;
  - the new outcomes and messages;
  - the reload on `PLAN_CHANGE_UNSUPPORTED` and `GIFT_EXPIRED`;
  - removal of the `403` copy.

  Verify that `publish-step.test.tsx` and `publish-action.test.ts` cover every new or reworded scenario of the `studio-editor` delta:
  - "Action not yet available" and "Publishing not enabled";
  - "Publish asks for confirmation" and "Publish after a pending change";
  - "Owner updates a published gift", "Standard through the internal grant" and "Selection follows the photo count";
  - "Photo limit refused by the server", "Expired gift cannot be updated" and "Free gift over its photo limit".

- [x] 8.3 Add the plan line and its expired form to `published-panel.tsx`, formatted in `Asia/Ho_Chi_Minh`. Verify that `published-panel.test.tsx` covers "Plan and expiry shown" and "Expired gift in the Studio" with a pinned clock (`vi.useFakeTimers({ toFake: ["Date"] })`).

## 9. Documentation

- [x] 9.1 Write `docs/adr/0011-versioned-plan-catalog.md` (design Decision 1), and update `docs/architecture.md`:
  - the "Entitlement" bullet becomes plans, the entitlement snapshot, expiry by server time and the internal grant;
  - the schema version 11 rollout note.

  Verify the architecture document no longer says that Sprint 4 replaces the internal flag.

- [x] 9.2 Add these risks to `docs/risk-register.md`, each with an owner, a mitigation and a target, and linking this change:
  - "Free publishing is open on Production before takedown exists";
  - "Rollback past schema version 11 breaks published gifts".

## 10. End-to-end

- [x] 10.1 Adapt the existing journeys:
  - in `publish.spec.ts`, publish the 8-photo gift on `Tiêu chuẩn` through the internal grant, and assert no `Tạo bằng LoveMemory` on `/g`;
  - in `publish-update.spec.ts`, publish on `Miễn phí` and assert the mark on `/g`, plus the plan line in the panel;
  - fix any other spec that sends the old publish body.
- [x] 10.2 Add a case to the Studio journey: a complete draft with 4 photos shows `Miễn phí` disabled with `Món quà đang có 4 ảnh, gói này cho tối đa 3 ảnh.` and `Tiêu chuẩn` selected. Verify `pnpm test:e2e` passes on the production build.

## 11. Verification and archive

- [x] 11.1 Run `pnpm verify:local` and verify that it passes: secrets, specs, format, lint, types, coverage gates, audit, build and installed-Chrome E2E. If a part cannot run locally, state which part and why in the PR.

  (2026-10-08. The first run stopped at `format:check`: the files edited by scripts had CRLF line endings, which `prettier --write` fixed. The second run passed secrets, specs, format, lint, types, coverage gates, audit and build. One installed-Chrome E2E test, `studio.spec.ts` "autosaves without a click and keeps the text after a reload", timed out at `Đang lưu…`. That run's other 33 tests passed. Investigation:
  - the rate-limit counters were far below their limits;
  - the full `pnpm test:e2e:chrome` rerun passed 34/34;
  - the test failed 2 of 8 runs on this branch, both back to back right after that gate run, then passed 6 runs in a row;
  - unmodified `dev` passed 2/2 in a throwaway E2E database.

  The change does not touch the save path. The failure is recorded as an intermittent remote-database timeout, not fixed, and no retry was added. The chromium and mobile-chromium suite passed 68/68.)

- [x] 11.2 Archive the change in the same PR with `pnpm openspec archive add-gift-plans-and-entitlements --yes`, after diffing each MODIFIED block against `openspec/specs/`. Then:
  - remove the three `modifiedBodyDrop` waivers of this change from `openspec/gate-exceptions.json`;
  - check that `openspec/specs/gift-plans/spec.md` has its Purpose.

  Verify `pnpm spec:check` passes after the archive.

## Out of scope

- Orders, checkout, payOS, webhooks, reconciliation, and upgrading a gift to Standard (later Sprint 5 changes).
- The `expired` stored status, the `gift.expire` job, renewal, and asset cleanup after expiry (the job outbox change and Sprint 6).
- A designed expired, paused or deleted page for recipients (Sprint 4 access-policy states).
- Enforcing `passwordAccess` and `scheduledAccess` (Sprint 4, once those policies are specified).
- Per-plan template availability, a Premium plan, coupons and subscriptions.
- Capping the photo picker by plan; a watermark in the preview; a plan property in analytics.
- Removing `INTERNAL_PLAN_GRANT_ENABLED` (the checkout change, when the fake billing provider exists).
