# Tasks

## 1. Pre-apply checks

- [x] 1.1 Before starting apply, confirm the starting point. Verify:
  - `pnpm openspec list` shows this change as the only active change;
  - `DATABASE_SCHEMA_VERSION` is still `9`;
  - the code still has every symbol that design Context names: `findPublishReplay` reading by `giftId` only, `findDraftById`, `markDeleting`, `isAssetVisible`, `publish-step.tsx` with `idempotencyKey.current ??=`, and `deleted: z.literal(true)` in `packages/contracts/src/upload.ts`.

  Re-diff each MODIFIED block of this change against the then-current `openspec/specs/` and merge any text that changed. Then verify that `pnpm openspec validate change-gift-publication-revisions --strict` and `pnpm spec:check` both pass.

- [x] 1.2 Confirm that `openspec/gate-exceptions.json` holds the four `modifiedBodyDrop` waivers for this change, each with owner `DevViTien` and expiry `2026-10-31`:
  - `database-schema-management` / "Idempotent migration with ledger";
  - `database-schema-management` / "Schema verification";
  - `gift-publishing` / "Published gift in the Studio";
  - `studio-editor` / "Studio preview and publish steps".

  If the archive slips past the expiry, the owner extends it with a reason; nobody unchecks tasks instead. Verify `pnpm spec:check` passes.

## 2. Domain and contracts

- [x] 2.1 In `packages/domain/src/gift`:
  - add `published → publishing` to `GIFT_TRANSITIONS`;
  - add the optional `publishedRevision` to `GiftSchema`, with the refinement of design Decision 2: `published` requires `shareId`, `publishedAt` and `publishedRevision <= revision`, and `draft` forbids all three;
  - export `EDITABLE_GIFT_STATUSES = ["draft", "published"]`.

  Verify that `gift-status.test.ts` and `gift-schema.test.ts` cover:
  - the new edge allowed;
  - `published → published` and `draft → published` still refused;
  - a published gift without `publishedRevision` rejected, and one with `publishedRevision` greater than `revision` rejected;
  - a draft with `publishedRevision` rejected.

- [x] 2.2 Make `publishGiftDraft` set `publishedRevision`. Add `republishGift` with the errors `GIFT_NOT_PUBLISHED`, `GIFT_REVISION_CONFLICT` and `GIFT_NO_UNPUBLISHED_CHANGES`. Let `updateGiftDraft` accept `draft` and `published` gifts. Verify in `gift-publication.test.ts` and `gift-draft.test.ts`:
  - a republish of revision `9` over `publishedRevision` `7` succeeds: same `shareId`, `publishedRevision` `9`, new `publishedAt`, `revision` unchanged;
  - refusals for a draft, a stale revision, and `expectedRevision` `7` over `publishedRevision` `7`;
  - `createGiftPublication` of a republished gift carries the gift's `shareId` and revision `9`;
  - saving a published gift increments `revision` and keeps `publishedRevision`;
  - `claimGiftDraft` still refuses a published gift.
- [x] 2.3 Add `detachedAt` (date or null, default `null`) to `MediaAssetSchema` in `packages/domain/src/media`, with the refinement that a detached asset is `ready` and has null slots. Verify `media-asset.test.ts` accepts:
  - a detached `ready` asset with null slots;
  - a legacy document without `detachedAt`.

  It rejects a detached asset that has slots or a non-`ready` status.

- [x] 2.4 Update `GiftDraftDtoSchema` in `packages/contracts/src/gift.ts`: `status` becomes `draft` | `published`, and add `publication` (`null`, or strictly `shareId`, `sharePath`, `publishedAt`, `revision`). The asset deletion response has no contract schema (the `upload.ts` cleanup schema belongs to the spike endpoint), so nothing changes there. Verify `gift.test.ts`:
  - accepts a draft with `publication: null` and a published DTO with its summary;
  - rejects a `publication` with extra keys or a `sharePath` with another prefix;
  - rejects a draft DTO missing `publication`.

## 3. Database schema version 10

- [x] 3.1 In `packages/database/src/migrations.ts`:
  - add `publishedRevision` (`int`, `minimum: 0`) to the `gifts` validator properties;
  - add `detachedAt` (`["date", "null"]`) to the `assets` validator properties;
  - add `gift_publications_share_id_unique` to `LEGACY_INDEX_NAMES.giftPublications` and remove it from the definitions;
  - add `backfillPublishedRevisions` (design Decision 8), run after the collections converge and before the ledger write;
  - set `DATABASE_SCHEMA_VERSION` to `10`.

  Verify that `migrations.test.ts` covers:
  - the validators;
  - the legacy drop, and the `Legacy MongoDB index remains` verification failure;
  - `MongoDB schema version mismatch: expected 10, received 1.`;
  - the backfill filter and pipeline: it only matches `published` gifts without the field, and a second run is a no-op;
  - "Database not yet migrated to version 10".

- [x] 3.2 Run the migration on a replica set at version `9`, with one published gift without `publishedRevision` and one draft. (Run on 2026-10-08 in the throwaway database `love_memory_v10_check` of the development Atlas cluster: the version-9 state was simulated by the current migrations plus the legacy unique index, the two gift documents and ledger `9`; the database was dropped afterwards.)
  1. `pnpm db:migrate`;
  2. `pnpm db:verify`;
  3. `pnpm db:migrate` again.

  Verify:
  - both runs succeed, and the ledger reads `10`;
  - the published gift has `publishedRevision` equal to its `revision`, and the draft has no `publishedRevision`;
  - `gift_publications_share_id_unique` no longer exists.

  Record the run in the PR.

- [x] 3.3 In `docs/runbooks/preview-deploy-and-rollback.md`:
  - add "Rolling back past schema version 10" (design Risks), modelled on the version 8 section;
  - state that `db:migrate` runs as soon as each tier's deployment is `Ready`, and that updates of published gifts answer `500` until then.

  Verify the section names schema version `10`, `publishedRevision` and `detachedAt`, and the preferred roll-forward.

## 4. Gift persistence

- [x] 4.1 In `mongo-gift-repository.ts`, replace `publishDraft` with `publish`, which takes the state the checks saw (design Decision 3):
  - for a draft, filter on `status: "draft"`;
  - for an update, filter on `status: "published"` and the read `publishedRevision`, or `$exists: false` when the stored document had none;
  - `$set` `publishedRevision` and `publishedAt`, and set `shareId` only on a first publish;
  - add `detachedAt: null` to the asset `updateMany` filter;
  - add a duplicate key on `gift_publications_gift_revision_unique` with no replay as a new outcome.

  Verify that `mongo-gift-repository.test.ts` asserts both filters and both `$set` shapes, the asset filter, and the new outcome.

- [x] 4.2 Change `findPublishReplay` to read the publication by `{ giftId, revision: expectedRevision }` (debt D5). Verify a repository test in which a gift with publications `7` and `9` replays key `K1` (revision `7`) and gets revision `7`.
- [x] 4.3 Make the repository's `updateDraft` filter on `status ∈ EDITABLE_GIFT_STATUSES`, and rename `findDraftById` to `findEditableById` with the same status set. In `mongo-gift-publication-repository.ts`, replace `findByShareId` with `findByGiftRevision(giftId, revision)`. Make `toDomain` read a legacy published gift without `publishedRevision` as having `publishedRevision = revision`. Verify repository tests cover:
  - the filters;
  - the lookup by `{ giftId, revision }`;
  - the legacy read.
- [x] 4.4 Document the publication model (working copy, `publishedRevision`, superseded publications) in `docs/architecture.md`, in the section about publishing. Verify it no longer says that published gifts are read-only.

## 5. Gift service and routes

- [x] 5.1 In `gift-service.ts`:
  - `publishGift` accepts `draft` and `published`, and adds the `NO_UNPUBLISHED_CHANGES` check after the revision check;
  - it calls `publishGiftDraft` or `republishGift`;
  - it maps the `stale` and duplicate-revision outcomes as in design Decision 3;
  - `gift_published` is recorded only when the gift was a `draft`.

  In `gift-route-helpers.ts`, map `NO_UNPUBLISHED_CHANGES` to `409` with `details.reason` `NO_UNPUBLISHED_CHANGES` and no `actualRevision`.

  Verify that `gift-service.test.ts` and `publish-route-handler.test.ts` cover every scenario of the `gift-publishing` delta:
  - "Already published", "Status that cannot be published" and "Invalid content in an update";
  - "Owner updates a published gift", "Concurrent updates of one revision" and "Replay after a later update";
  - "Update of a published gift" (no second `gift_published`).

- [x] 5.2 Make `getDraft`, `updateDraft` and `getStudioGift` accept published gifts:
  - `getStudioGift` returns the editor view with `analytics: null` for a published gift;
  - `toDto` builds `publication` from the gift's own fields;
  - claim stays draft-only.

  Verify service and route tests for:
  - "Published gift in the draft API and the Studio" and "Owner saves a published gift's working copy";
  - "Gift in another status", "Another creator cannot edit a published gift" and "Claim refused for a published gift";
  - "Published gift summary".

## 6. Preview

- [x] 6.1 In `preview-service.ts`, use `EDITABLE_GIFT_STATUSES` for issuance and opening, through `findEditableById`. Verify `preview-service.test.ts` covers:
  - "Published or deleted gift";
  - "Gift no longer a draft" (the working copy is rendered for a published gift);
  - "Preview link survives the first publish".

## 7. Media

- [x] 7.1 In `media-service.ts`:
  - `isAssetVisible`, `initializeUpload` and `listAssets` accept `EDITABLE_GIFT_STATUSES`, and detached assets are invisible;
  - `deleteAsset` returns `{ assetId, deleted: false }` for the new `detached` outcome of `markDeleting`.

  Verify `media-service.test.ts` covers:
  - "Assets of a published gift", "Another creator and a published gift", "Gift in another status" and "Gift that is not a draft";
  - "Photo of the current publication detached" and "Photo added after publishing";
  - a `404` for reading, retrying or deleting a detached asset.

- [x] 7.2 In `mongo-media-repository.ts`:
  - `markDeleting` follows design Decision 5: gift read by editable status, current publication read, then detach or move to `deleting`, all in one transaction;
  - the quota query, `listAssets`, `listByGiftId` and `findAuthorizedAsset` exclude `detachedAt` non-null;
  - `validateMediaReferences` in the gift repository filters on `detachedAt: null`;
  - `listByIdsForGift` stays unfiltered.

  Verify `mongo-media-repository.test.ts` asserts:
  - the detach `$set` (`detachedAt`, null slots);
  - the exclusion filters;
  - "Replacing a published photo in a full field" (detached assets do not count).

- [x] 7.3 Confirm that `media-image-list-field.tsx` treats `{ deleted: false }` as a successful removal (item removed, order reported, no message); it does not parse the `200` body today. Verify with a `media-image-list-field.test.tsx` case for that response next to the existing `deleted: true` and `404` cases.
- [x] 7.4 Add to `docs/risk-register.md`:
  - "Detached and superseded assets stay in Blob storage until cleanup";
  - "Superseded publications keep old gift text".

  Each entry needs an owner, a mitigation and its target (`asset.cleanup` in Sprint 5, deletion and retention in Sprint 6). Verify both rows are present and link this change.

## 8. Public viewer

- [x] 8.1 Make `resolveLiveShare` in `public-gift-service.ts` read `findByGiftRevision(gift.id, gift.publishedRevision)` and require `publication.shareId === gift.shareId`. Verify `public-gift-service.test.ts` covers:
  - "Working copy is not served", "Updated gift" and "Detached photo still signed";
  - "Missing publication record": no publication for `publishedRevision` while an older one exists gives not-found.

## 9. Studio

- [x] 9.1 Make `app/studio/[publicId]/page.tsx` render `DraftEditor` for both statuses, and move `PublishedPanel` into the editor tree with the panel status of `gift-publishing` ("Published gift in the Studio"). The store holds `publication` and derives unpublished changes (design Decision 7). Verify that `published-panel.test.tsx` and `draft-editor.test.tsx` cover:
  - "Owner reopens a published gift" and "Copy the link";
  - "Unpublished changes shown after a save": the status changes without a reload.
- [x] 9.2 Give `publish-step.tsx` the `publish` and `update` modes:
  - the new first-publish note and confirmation text;
  - the `Cập nhật món quà` disabled cases, confirmation, busy label and success texts;
  - the update wording of the failure messages;
  - the reload on `NO_UNPUBLISHED_CHANGES`;
  - a new `Idempotency-Key` after each `201`;
  - the published panel shown above the editor after a first publish.

  Verify `publish-step.test.tsx` and `publish-action.test.ts` cover every new or changed scenario of the `studio-editor` delta:
  - "Nothing to update", "Owner updates a published gift" and "New key after a success";
  - "Update request fails", "Gift published in another tab" and "Publish after a pending change";
  - the two "Read-only editor states" scenarios that changed.

- [x] 9.3 Clear the editor's analytics context after a first publish, and send no events for a published gift. Verify a Studio analytics test for "Editing a published gift": no event after a caption edit, a preview or an update, and none after a first publish in the same page.

## 10. Persistence verification on a real replica set

- [x] 10.1 Extend `scripts/verify-gift-persistence.ts` with the republish sequence of `database-schema-management` "Gift persistence verification":
  - a working-copy save;
  - an update under a new key with the same `shareId`;
  - the `explain` of the current-publication lookup on `gift_publications_gift_revision_unique`;
  - a replay of the first key;
  - a refused second publish of the same revision;
  - a detach of a current-publication asset;
  - the adapted publish-versus-delete race.

  Keep the residue cleanup. Run `pnpm db:verify-gifts` against the local replica set at version `10`, and verify it prints `Gift persistence verification completed successfully.` and leaves no residue.

## 11. End-to-end

- [x] 11.1 Add this journey in `apps/web/e2e/publish-update.spec.ts`, and adapt step 7 of `apps/web/e2e/publish.spec.ts` (the owner now reads the working copy, and a photo of the publication is detached): publish a Memory Box gift, change `final-letter` in the Studio, then check:
  - the panel shows the unpublished-changes status;
  - an anonymous context at `/g/{shareId}` still shows the old letter;
  - `Cập nhật món quà` then `Xác nhận cập nhật` makes the anonymous context show the new letter at the same link after a reload;
  - `Cập nhật món quà` is then disabled with `Người nhận đang xem bản mới nhất. Hãy chỉnh sửa trước khi cập nhật.`.

  Verify `pnpm test:e2e -- publish.spec.ts` passes on the production build.

- [x] 11.2 Add an E2E case: on a published gift with 3 photos, delete one in the Studio, upload a replacement, and confirm the anonymous recipient still sees the original photo until the update, and the replacement after it. Verify it passes in the same run.

## 12. Verification and archive

- [x] 12.1 Run `pnpm verify:local` and verify it passes: secrets, specs, format, lint, types, coverage gates, audit, build and installed-Chrome E2E. If a part cannot run locally, state which part and why in the PR.
- [x] 12.2 Record the outcomes in `docs/sprints/sprint-3-review.md`: PO decision P6 is resolved by this change, and debt D5 is half resolved (replay by revision; the per-actor namespace is still open). Verify both rows reference `change-gift-publication-revisions`.
- [x] 12.3 Archive the change in the same PR with `pnpm openspec archive change-gift-publication-revisions`. Then remove its four `modifiedBodyDrop` waivers from `openspec/gate-exceptions.json`. Before archiving, diff each MODIFIED block against `openspec/specs/` as the archive guidance asks. Verify `pnpm spec:check` passes after the archive.

## Out of scope

- `Hủy thay đổi`: discarding unpublished changes back to the current publication.
- Choosing, comparing or rolling back to an older publication.
- Upgrading a published gift to a newer template version.
- A publish outbox, `publish.finalize`, a persisted `publishing` state and background publish retries (Sprint 5).
- Removing detached assets, superseded publications and their objects (`asset.cleanup`, Sprint 5; retention and deletion, Sprint 6).
- A per-actor namespace for idempotency keys (the second half of debt D5).
- Debt D4: validator `anyOf` per status, a migration downgrade guard, and index rebuilds under a temporary name.
- A `gift_updated` analytics event and recipient notifications (PO decision P11).
- Pause, resume, delete, revoke, expiry, password and scheduled access, QR and the dashboard (later Sprint 4 changes).
