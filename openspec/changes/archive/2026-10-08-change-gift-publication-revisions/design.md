# Design

## Context

See proposal.md for why this change exists, and the delta specs for the observable behavior. This
section describes only the code it changes. All of it is on `dev` today.

**Gift domain** (`packages/domain/src/gift`)

- `GIFT_TRANSITIONS` has `draft → publishing`, `publishing → published` and `published → paused |
expired | deleting`. There is no edge back into `publishing` from `published`.
- `GiftSchema` is `.strict()`. Its `superRefine` requires `shareId` and `publishedAt` on a
  `published` gift and forbids them on a `draft`.
- `updateGiftDraft` and `publishGiftDraft` both refuse anything that is not a `draft`.
- `createGiftPublication` copies `revision`, `shareId`, `publishedAt` and the content from the
  gift.

**Persistence** (`apps/web/src/modules/gifts/infrastructure/mongo-gift-repository.ts`)

- `updateDraft` and `findDraftById` (the preview read) filter on `status: "draft"`.
- `publishDraft` runs one transaction:
  1. a replay lookup;
  2. a conditional `findOneAndUpdate` on `{ _id, access.mode: unlisted, ownerId, revision, status:
draft }`;
  3. an `updateMany` with `$currentDate` on the referenced `ready` assets, so a concurrent delete
     conflicts;
  4. the inserts into `giftPublications` and `idempotencyKeys`.
- `findPublishReplay` reads the publication with `findOne({ giftId })`. That is ambiguous as soon as
  a gift has two publications (debt D5).

**Public viewer** (`modules/public-gifts/application/public-gift-service.ts`)

- `resolveLiveShare` reads the gift with `findPublishedByShareId`, then the publication with
  `publications.findByShareId(shareId)`. The second lookup is served by
  `gift_publications_share_id_unique`.

**Media** (`modules/media`)

- `isAssetVisible` requires `gift.status === "draft"`. `initializeUpload` and `listAssets` repeat
  that check.
- `markDeleting` checks inside one transaction that the gift is still a draft, then moves the asset
  to `deleting`.
- Quotas count every asset in an active status (`occupied.length`), and their slot indexes are
  partial on numeric `giftSlot`/`fieldSlot`.
- The Studio image field calls `DELETE` before it reports the new order, and treats any `200` as
  removed.

**Studio**

- `app/studio/[publicId]/page.tsx` renders either `PublishedPanel` alone or `DraftEditor`.
- `publish-step.tsx` keeps one `Idempotency-Key` per page, `idempotencyKey.current ??=
crypto.randomUUID()`, and on `201` hands the publication to the page, which swaps the editor out.

**Database** (`packages/database/src/migrations.ts`)

- `DATABASE_SCHEMA_VERSION = 9`.
- Migration is declarative and idempotent: validators are replaced, drifted indexes are rebuilt,
  and `LEGACY_INDEX_NAMES` are dropped.
- There is no data step yet.

## Goals / Non-Goals

**Goals:**

- One gift document carries both the working copy and a pointer to the publication recipients see.
  Moving that pointer is the only thing that changes what recipients see, and it happens in the
  same transaction as the new publication.
- Reuse every draft mechanism for the working copy: autosave, revisions, conflicts, validation,
  media binding and preview.
- Keep each concurrency guarantee of the first publish for updates: a revision conflict, a
  deletion versus a publish, and a double click.

**Non-Goals:**

- No new collection and no new route.
- No change to how `/g` renders, its headers or its rate limits.
- The publication record format stays the same.

## Decisions

Governing ADRs. No decision here contradicts an accepted ADR, so no ADR update is planned.

- **ADR-0002** (MongoDB, official driver, Zod at boundaries): the pointer, the conditional writes,
  the backfill step and the validators.
- **ADR-0003** (private Blob storage, assets referenced by id): detaching instead of copying or
  deleting objects.
- **ADR-0004** (immutable artifacts, gifts pin an exact version): every publication keeps pinning
  `templateVersion` and `artifactContentHash`.
- **ADR-0008** (Trigger.dev fed by the outbox): why the publish outbox and asset cleanup are
  deferred to their first real consumer.

### 1. Working copy in place, with a `publishedRevision` pointer

A published gift keeps `content` and `revision` as its working copy. A new optional field
`publishedRevision` names the current publication by `{ giftId, revision }`.

- Recipients are served `giftPublications.findOne({ giftId, revision: publishedRevision })`, which
  `gift_publications_gift_revision_unique` covers.
- `publishedAt` on the gift becomes the time of the current publication, which the Studio and
  dashboard show. The first publication time stays recoverable from the oldest record.

Alternatives considered:

- **A separate "edit draft" document per published gift.** It duplicates ownership, the anonymous
  rules, media binding (assets are bound to `giftId`) and the Studio routing.
- **"The latest publication" by sort, with no pointer.** It needs a sorted lookup on every public
  read. It also makes later pause or rollback features, which may point at an older revision,
  impossible without a schema change.
- **Copying the published content back into the gift on each edit.** It is pointless, because the
  content already is the gift's.

### 2. Domain: one more edge and an explicit update function

- Add `published → publishing` to `GIFT_TRANSITIONS`. Keep `publishing → published` (it already
  exists).
- Add `republishGift(gift, { expectedRevision, now })`. It refuses:
  - a non-`published` gift (`GIFT_NOT_PUBLISHED`);
  - a stale revision (`GIFT_REVISION_CONFLICT`);
  - `expectedRevision <= publishedRevision` (`GIFT_NO_UNPUBLISHED_CHANGES`).

  It goes through `publishing`, sets `publishedRevision` and `publishedAt`, and keeps `shareId`.

- `publishGiftDraft` also sets `publishedRevision`.
- The `GiftSchema` refinement becomes:
  - `published` requires `shareId`, `publishedAt` and `publishedRevision <= revision`;
  - `draft` forbids all three.
- `updateGiftDraft` accepts `draft` and `published`. The name stays: it updates the editable
  content.
- `createGiftPublication` is unchanged; it already copies `revision` and `shareId` from the gift.
- Transition and refinement tests cover every new edge and refusal, as the project rules require
  for new gift states and transitions.

### 3. One publish path in the service, two write shapes in the repository

`publishGift` keeps its check order and adds the `NO_UNPUBLISHED_CHANGES` check after the revision
check. It then calls `publishGiftDraft` or `republishGift`. The repository's `publish` builds the
conditional filter from what the checks read:

- **draft:** `{ status: "draft" }`;
- **update:** `{ status: "published", publishedRevision: <read value> }`. When the stored document
  had no `publishedRevision`, the filter uses `publishedRevision: { $exists: false }` instead (see
  Migration Plan).

The write sets `status`, `publishedRevision`, `publishedAt` and `updatedAt`, and sets `shareId` on
a first publish only. Everything else in the transaction stays as it is, with one addition: the
asset `updateMany` adds `detachedAt: null` to its filter.

The transaction can end in four ways:

- **`stale`:** re-read through the owner filter and map:
  - a status that is neither `draft` nor `published` → `INVALID_STATE`;
  - another revision → `REVISION_CONFLICT`;
  - `publishedRevision >= expectedRevision` → `NO_UNPUBLISHED_CHANGES`.
- **Duplicate key on `gift_publications_gift_revision_unique` with no matching replay:** this is a
  concurrent update of the same revision under another key. It is mapped the same way, which gives
  `NO_UNPUBLISHED_CHANGES`.
- **Replay:** the lookup becomes `findOne({ giftId, revision: expectedRevision })`. The idempotency
  fingerprint already contains `expectedRevision`, so a matching key always names that revision.
  This fixes D5's ambiguity. The per-actor key namespace stays out of scope.
- **Route mapping:** `NO_UNPUBLISHED_CHANGES` → `409` with `details.reason`
  `NO_UNPUBLISHED_CHANGES`, in `gift-route-helpers.ts` next to the existing reasons.

### 4. Draft, preview and media status sets

There is one shared constant: `EDITABLE_GIFT_STATUSES = ["draft", "published"]` in the domain.
These places use it, both in their queries and in the service-level re-checks:

- `findAuthorized` callers (`getDraft`, `updateDraft`);
- the repository's `updateDraft` filter;
- the preview read, where `findDraftById` becomes `findEditableById`;
- `isAssetVisible`, `initializeUpload` and `listAssets`;
- the gift read inside `markDeleting`.

Claim stays draft-only.

`getStudioGift` returns the editor view for both statuses. For a `published` gift its analytics
context is `null`, which is how "no Studio events for a published gift" is enforced on the server
side.

The draft DTO's `publication` summary is built from the gift's own `shareId`, `publishedAt` and
`publishedRevision`, so it needs no extra query.

### 5. Detach instead of delete, decided inside the delete transaction

`markDeleting(assetId, giftId, now)` becomes a single transaction with two outcomes:

1. Read the gift by `_id` and `status ∈ EDITABLE_GIFT_STATUSES`, projecting `status` and
   `publishedRevision`.
2. For a `published` gift, read the current publication's `assetIds` with the same session.
3. If it contains the asset, update the asset with filter `{ _id, giftId, status: "ready",
detachedAt: null }` and set `detachedAt`, `giftSlot: null`, `fieldSlot: null` and `updatedAt`.
   The result is `detached`.
4. Otherwise, move the asset to `deleting` exactly as today.

Why concurrency stays safe: a publish writes every asset it references, and both outcomes write
the asset, so a publish that adds the asset and a concurrent delete conflict. The retried
transaction then sees the other's result. This is the same reasoning as today's draft check.

A republish that drops the asset does not write it. A concurrent delete may therefore still detach
it based on the old publication. The asset is then unreferenced but harmless, and the later
cleanup job removes it.

`detachedAt` (date or null, default `null`) is added to `MediaAssetSchema`. A refinement requires
a detached asset to be `ready` with null slots. Detached assets are excluded from:

- the quota query (`occupied` adds `detachedAt: null`);
- `listAssets` and `listByGiftId` (the publish and preview checks, so a working copy that still
  references a detached asset reports a content issue);
- `findAuthorizedAsset`;
- `validateMediaReferences`.

`listByIdsForGift`, used by the public viewer, does not exclude them.

Alternatives considered:

- **Refusing the delete with `409`.** The owner of a full 8-photo field could then never replace a
  photo, because the kept asset would hold its quota slot.
- **A new asset status `detached`.** It would change the asset state machine of plan.md §8.2, the
  validator enum and every status switch. A `ready` asset that is merely out of the working copy is
  not a new lifecycle state.
- **Copying blobs on publish.** It is long-running storage work inside a request, which the
  invariants forbid, and it doubles storage.

### 6. Public viewer lookup

`GiftPublicationRepository.findByShareId` is replaced by `findByGiftRevision(giftId, revision)`.
`resolveLiveShare` calls it with `gift.publishedRevision` and checks that
`publication.shareId === gift.shareId`.

`gift_publications_share_id_unique` moves to `LEGACY_INDEX_NAMES.giftPublications`. No index on
`giftPublications.shareId` remains, because nothing queries by it.

A recipient whose payload refresh (the 300-second asset URL refresh) happens after an update
receives the new publication. That matches "recipients see the current publication", and the gift
viewer already re-renders from a refreshed payload. No spec change is needed.

### 7. Studio composition

- The page renders `DraftEditor` for both statuses. `PublishedPanel` moves inside the editor tree
  so its status line can follow the store.
- The store gains `publication: PublicationSummary | null`, set from the DTO and replaced after
  each `201`.
- "Unpublished changes" is derived as `dirty || lastSavedRevision > publication.revision`.
- `publish-step.tsx` gets a `mode` (`publish` | `update`) derived from `publication`, which selects
  the texts of the `studio-editor` spec. It resets `idempotencyKey.current` to `null` after every
  `201`.
- After a first publish, the editor clears its analytics context, so no event follows in that page.
- `media-image-list-field.tsx` already treats every `200` of `DELETE` as a removal without parsing
  the body, so `{ deleted: false }` needs no client or contract change; a test pins that. (The
  `deleted: z.literal(true)` schema in `packages/contracts/src/upload.ts` belongs to the spike's
  upload cleanup endpoint, not to asset deletion.)

### 8. Schema version 10 with a backfill step

`migrations.ts` changes as follows:

- **Validators:**
  - `gifts`: add `publishedRevision` (`int`, `minimum: 0`) under `properties`, not `required`;
  - `assets`: add `detachedAt` (`["date", "null"]`).
- **Indexes:** add the legacy index name for `giftPublications`.
- **Data step:** add `backfillPublishedRevisions(database)`, run after the collections converge
  and before the ledger write. It runs `updateMany({ status: "published", publishedRevision: {
$exists: false } }, [{ $set: { publishedRevision: "$revision" } }])`. This is an update
  pipeline, which Stable API V1 allows. It is idempotent, and it is exact because no published gift
  could be edited before this change.
- **Ledger:** bump `DATABASE_SCHEMA_VERSION` to `10`.

`db:verify` needs no data check, because the migration leaves no published gift without a pointer.
The deployment window before `db:migrate` runs is covered by the repository instead:
`mongo-gift-repository.ts` `toDomain` reads a published document without `publishedRevision` as
`publishedRevision = revision`. Such a document can only be a gift published before this change,
so the domain refinement still holds for every gift it receives. A save of a published gift also writes its `publishedRevision`, so the first save in that window persists the pointer instead of letting the read-time fallback follow the new revision.

`scripts/verify-gift-persistence.ts` gains the republish sequence of the
`database-schema-management` spec. That includes `explain` of the current-publication lookup and a
detach of an asset that the current publication references.

## Risks / Trade-offs

- **[Risk] Detached assets and assets referenced only by superseded publications stay in Blob
  storage.**
  - Mitigation: they are bounded by the `gift-publish` rate limit (10 per 10 minutes) and the
    per-gift 30-asset working quota.
  - They are listed in the risk register with an owner, and are removed by `asset.cleanup` (plan.md
    §14.4) or the Sprint 6 deletion work.
  - Production cannot publish yet.
- **[Risk] Superseded publications keep old gift text.** That is private content kept beyond the
  owner's edit.
  - Mitigation: they are never served or logged. Deleting a gift (a later Sprint 4 change and
    Sprint 6) must delete all publication records, which is noted for that change.
  - Retention of superseded publications is a Sprint 6 privacy decision.
- **[Risk] Old build against the new data on rollback.** The previous build parses `gifts` and
  `assets` strictly, and fails on `publishedRevision` and `detachedAt`. This affects `dev` and `stg`
  only, because Production never published.
  - Mitigation: a runbook section "Rolling back past schema version 10", modelled on the version 8
    section. Prefer rolling forward. The script for a clean rollback is reviewed at that time.
- **[Risk] Window between deployment and `db:migrate`.** In that window the legacy unique index
  still rejects a second publication with the same `shareId`. An update then fails with `500`
  until the migration runs, and the first publication keeps being served.
  - Mitigation: the runbook runs `db:migrate` immediately after the deployment is `Ready`.
  - The update filter accepts a missing `publishedRevision` (Decision 3), so nothing else breaks.
- **[Trade-off] A replayed old key returns the old publication even after a newer update.** This
  is faithful idempotency. The Studio never replays an old key, because it rotates keys after
  `201`.
- **[Trade-off] The owner can no longer see the content exactly as recipients see it while there
  are unpublished changes.** `Mở món quà` shows recipients' view and the preview shows the working
  copy. A diff view is out of scope.

## Migration Plan

1. Merge to `dev`. CI runs the unit and E2E suites against a fresh database at version `10`.
2. Promote as usual. For each tier, as soon as the deployment is `Ready`, run `db:migrate`: schema
   version `10`, the legacy index dropped and the backfill. Then run `db:verify` and
   `db:verify-gifts`.
3. Smoke test on `stg`:
   - open an existing published test gift: same link, same content;
   - edit it in the Studio, preview, update;
   - reopen `/g/{shareId}` in an anonymous browser and see the new content.
4. Rollback: see the Risks section and the new runbook section. Reverting the code is safe for
   drafts. On `dev` and `stg`, published test gifts answer `500` in the old build until a roll
   forward.

## Open Questions

- Final Vietnamese copy for the update texts (`Cập nhật món quà`, the confirmation and the panel
  status). They are written in the spec and can be revised in the PO copy review (decision P7)
  without changing behavior.
