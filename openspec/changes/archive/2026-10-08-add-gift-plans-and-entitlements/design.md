# Design

## Context

For why this change exists and what it delivers, see proposal.md. The code it builds on, as it
stands at `44f40fe`:

- **The publish gate.** `gift-service.ts` `publishGift` asks a synchronous port,
  `PublishEntitlement.canPublish(ownerId)`. It runs after the owner lookup, so a non-owner gets `404`
  before the flag is consulted. `composition/gifts.ts` wires the port to
  `config/internal-publish.ts`, and the Studio page passes the same flag as `publishEnabled`.
- **One publish transaction.** `mongo-gift-repository.ts` `publish` does all of the following in one
  transaction:
  1. a replay check;
  2. a conditional `findOneAndUpdate` of the gift, on the owner, `access.mode: "unlisted"`, the
     revision and the precondition;
  3. asset confirmations;
  4. the `giftPublications` insert;
  5. the `idempotencyKeys` insert.

  The request fingerprint is `JSON.stringify(["publish", publicId, expectedRevision])`.

- **Strict parsing.** `GiftSchema` is `.strict()`, and `toDomain` parses every gift document with it.
  A build that does not know a new field fails on it (see Risks).
- **The share lookup.** `findPublishedByShareId` filters on `access.mode`, `shareId`
  (`$eq` and `$type`, so that the partial `gifts_share_id_unique` index is eligible) and `status`.
  The index `gifts_status_expiry` on `{ status, expiresAt }` already exists, but no gift has an
  `expiresAt` yet.
- **Counting photos.** `listImageFieldReferences(manifest, content)` in `packages/template-sdk`
  lists the asset references of every image field. The server and the browser can both count photos
  from it.
- **The public page.** `PublicGiftScreen` renders `GiftViewer` inside a rounded frame. The `/g` page
  passes only `shareId` and the analytics context.
- **Photo counts in E2E.** `publish.spec.ts` publishes 8 photos (the Gate M2 evidence), while
  `publish-update.spec.ts` and `gift-performance.spec.ts` use 3.

The governing ADRs are ADR-0001 (modular monolith), ADR-0002 (native driver with Zod at the
boundaries) and ADR-0009 (billing boundary: only a verified payment or reconciliation marks an order
paid; the order snapshots the price). The new ADR-0011 records Decision 1.

## Goals / Non-Goals

**Goals:**

- One server-side source of plan values, which the publish service, the public lookup and the
  Studio all read, so that no limit is written twice.
- A plan grant that sits behind a port, so the checkout change only adds a new outcome. The publish
  checks stay as they are.
- Expiry that is decided by server time in the database filter, and that never depends on a job.

**Non-Goals:**

- A plan collection, an admin interface for prices, or price experiments.
- Moving a stored gift to `expired`, and cleaning up after expiry. These are the `gift.expire` and
  `asset.cleanup` jobs of the job outbox change.

## Decisions

### 1. Plans are versioned code constants (ADR-0011)

`packages/domain/src/billing/plan.ts` exports:

- `PLAN_IDS = ["free", "standard"]`;
- `PlanSchema` (strict);
- `PLAN_CATALOG`, a frozen array holding each released version;
- `currentPlan(planId)`, which returns the highest `planVersion` of a plan.

A new price or limit is a new entry, and released entries never change. A test pins `free@1` and
`standard@1` to the values in the `gift-plans` table.

- **Alternative: a `plans` collection seeded by `db:seed`.** Rejected. It would need seeding, drift
  verification and an operator path for edits. It would also be able to change a price without a
  code review. Granted entitlements and, later, orders keep their own snapshot, so history never
  needs the catalog (tech-stack.md §11.3).
- **Alternative: plan values in environment variables.** Rejected. They are untyped, they could
  differ per tier, and they leave no history.

### 2. The entitlement is embedded in the gift document

`GiftSchema` gains `entitlement` (`GiftEntitlementSchema` in `billing/gift-entitlement.ts`) and
`expiresAt`, both optional. The refinement extends the existing one:

- a `published` gift requires both fields;
- a `draft` forbids both;
- `expiresAt` must equal `grantedAt + retentionDays`, in days of 86 400 000 ms.

`grantEntitlement(plan, source, now)` builds the snapshot.

- **Why embedded.** The first publish already writes the gift conditionally inside the publish
  transaction, so the grant is atomic with it at no extra cost. The public lookup can then filter
  `expiresAt` on the same document and through the same index.
- **Payment later.** The payment change adds an `orders` collection that references the gift. A
  verified payment then sets `entitlement` on the gift in the same transaction that marks the order
  paid.
- **Alternative: an `entitlements` collection.** Rejected for now. Every public read would need a
  second lookup or a join, and the grant would need a second conditional write in the transaction.

### 3. The plan is chosen in the publish request, not stored on the draft

`PublishGiftRequestSchema` becomes `{ expectedRevision, planId }`. The Studio keeps the selection
in its own state only.

- **Alternative: `planId` on the draft, saved through `PATCH`.** Rejected. The selection would
  churn revisions and autosave, and it would create "unpublished changes" for a gift that has none.
  It would also need its own conflict rules.

For an update, the request repeats the entitlement's plan. `PLAN_CHANGE_UNSUPPORTED` reserves the
upgrade path for checkout.

### 4. The `PlanGrantPolicy` port replaces `PublishEntitlement`

`gift-service.ts` defines the port as follows:

```ts
export type PlanGrant =
  Readonly<{ kind: "grant"; source: "free" | "internal" }> | Readonly<{ kind: "unavailable" }>;
export interface PlanGrantPolicy {
  /** Synchronous: availability depends only on the plan and configuration today. */
  grantFor(planId: PlanId): PlanGrant;
}
```

`composition/gifts.ts` wires it as follows:

- `free` gives `{ kind: "grant", source: "free" }`;
- `standard` gives `{ kind: "grant", source: "internal" }` when `getInternalPlanGrantEnvironment()`
  is on, and `{ kind: "unavailable" }` otherwise.

The checkout change adds a third outcome, `{ kind: "checkout" }`, and handles it in `publishGift`.
The ownerless signature keeps the port pure. Per-owner rules, such as an allowlist (PO decision P4),
can add an `ownerId` parameter later.

The Studio page builds the plan offers with the same policy. `PlanOfferDtoSchema` is defined in
`packages/contracts`, with:

- the plan fields;
- `available` (whether the plan can be chosen);
- `internalGrant` (whether the internal grant supplies it).

The page passes the offers to `DraftEditor` as props, so no route is added. The browser never holds
a plan constant.

`config/internal-publish.ts` is renamed to `config/internal-plan-grant.ts`
(`parseInternalPlanGrantEnvironment`). It keeps the same parsing rules: on only for exactly `true`,
never on Production, and it never throws.

### 5. Check order and refusal shape

`publishGift` follows the order of `gift-publishing` "Pre-publish checks". The plan checks come
after the cheap state checks and before template resolution, and the photo limit comes last, after
the content issues. The photo limit sits last because:

- a content issue (`400`) is more actionable than a plan limit;
- the photo count must come from content that is valid.

Every refusal is a `409` `CONFLICT` with a `details.reason`, the pattern the Studio already maps.
The API gains no `PAYMENT_REQUIRED` code: the checkout change answers `standard` with a checkout,
not with an error.

The gift service gains the failure codes `PLAN_NOT_AVAILABLE`, `PLAN_CHANGE_UNSUPPORTED`,
`GIFT_EXPIRED` and `PLAN_PHOTO_LIMIT_EXCEEDED { maxPhotos, photoCount }`. `gift-route-helpers.ts`
maps them to the reasons and details of the spec. `FORBIDDEN` leaves the publish path.

The photo count is a new `countImageItems(manifest, content)` in `packages/template-sdk`, next to
`listImageFieldReferences`. It counts items, not unique asset ids, so it matches what the creator
sees.

### 6. The entitlement in the publish write

`publishGiftDraft(gift, { expectedRevision, now, shareId, entitlement })` sets `entitlement` and
`expiresAt`. `republishGift` is unchanged and carries both fields from the gift.

In the repository:

- **First publish.** The conditional update `$set`s `entitlement` and `expiresAt`, together with
  `shareId`.
- **Update.** The filter adds `expiresAt: { $gt: now }`. A write that fails on that clause takes
  the existing `stale` path. The service re-reads the gift, sees `expiresAt <= now` and answers
  `GIFT_EXPIRED`. This check runs before the revision tests of that path, because expiry is
  terminal.

The idempotency fingerprint becomes
`JSON.stringify(["publish", publicId, expectedRevision, planId])`.

### 7. Expiry in the share lookup

`findPublishedByShareId(shareId, now)` adds `expiresAt: { $gt: now }` to the filter.

- **Index.** The equality on `shareId` keeps `gifts_share_id_unique` as the plan, and
  `db:verify-gifts` keeps asserting it with `explain`. The extra clause is a residual filter on one
  document.
- **Time source.** `public-gift-service.ts` reads `now` from its injected clock once per request.
- **Page and payload agree.** The page and the payload endpoint share `resolveLiveShare`, so they
  cannot disagree.
- **Legacy gifts.** A document without `expiresAt` never matches `$gt`. Every published gift has
  one after the backfill. Between deploy and `db:migrate`, the build answers `404` for legacy links
  instead of serving them without an expiry. This fails closed and is documented in the runbook.
- **Legacy reads.** Like the existing `publishedRevision` fallback, `toDomain` reads a published
  document without `entitlement` with exactly the entitlement the backfill writes:
  `LEGACY_ENTITLEMENT` (exported by `packages/database` beside the migration), granted at
  `publishedAt`. The owner's Studio therefore keeps working before `db:migrate`. (This was found
  during apply; it replaced an accepted `500` for those Studio pages.)

`resolvePublicGiftPage` additionally returns `watermark: gift.entitlement.watermark`.

### 8. Host-level watermark

`PublicGiftScreen` takes `watermark: boolean` and renders this element inside the frame `div`,
after the viewer:

```html
<p class="pointer-events-none absolute right-3 bottom-2 …">Tạo bằng LoveMemory</p>
```

The frame `div` becomes `relative`.

- **Not in the template.** The template, its payload, the template SDK and the preview are
  untouched, so the "preview equals published" comparisons keep comparing equal inputs.
- **Contrast.** The text is a small semi-transparent label on a light chip. It must pass WCAG
  contrast on both themes; a component test checks the classes.

### 9. Studio

- **The page.** `app/studio/[publicId]/page.tsx` passes `planOffers` instead of `publishEnabled`.
- **The store.** The store holds `publication`, which already carries the new fields.
- **The plan choice.** A new `plan-choice.tsx` is a radio group whose descriptions are formatted from
  the offers:
  - prices with `Intl.NumberFormat("vi-VN")` plus `đ`;
  - `365` days as `1 năm`.
- **Publish logic.** `publish-step.tsx` computes the disabled states from:
  - `countImageItems(manifest, content)`;
  - the offers, for a draft;
  - `publication.maxPhotos` and `publication.expiresAt`, for a published gift.

  The "expired" comparison uses the browser clock for display only; the server decides.

- **Request and outcomes.** `publish-action.ts` sends `planId`, and `classifyConflict` maps the new
  reasons to the new `PublishOutcome` kinds:
  - `plan-unavailable`;
  - `photo-limit`, carrying `maxPhotos` and `photoCount`;
  - `reload`, for `PLAN_CHANGE_UNSUPPORTED` and `GIFT_EXPIRED`.

  The `forbidden` kind is removed.

- **The panel.** `published-panel.tsx` formats `expiresAt` with
  `Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })` into `HH:mm dd/MM/yyyy`.

### 10. Data shape and migration (schema version `11`)

- **Validator.** The `gifts` validator gains `entitlement`, an object with the required keys and
  enums of the spec, `maxPhotos` `["int", "null"]` and `grantedAt` `date`, plus `expiresAt` `date`.
- **Backfill.** `backfillLegacyEntitlements` runs after `backfillPublishedRevisions`. It is one
  `updateMany`:
  - filter: `{ status: "published", entitlement: { $exists: false } }`;
  - an update pipeline that sets `entitlement` to the `standard@1` snapshot built from
    `PLAN_CATALOG`, with `grantedAt: "$publishedAt"`;
  - `expiresAt: { $dateAdd: { startDate: "$publishedAt", unit: "day", amount: 365 } }`.

  A second run matches nothing.

- **Why `standard@1` and `legacy`.** These gifts were internal test gifts with up to 8 photos.
  Granting them `free` would put them over the photo limit and expire them within 14 days.
- **No new index.** `gifts_status_expiry` already serves the later `gift.expire` sweep.

## Risks / Trade-offs

- **Free publishing becomes possible on Production.** Takedown arrives only in Sprint 6, and staging
  access is still PO decision P4. → A risk-register row records it. Promotion to `main` stays
  governed by the release gates; this change does not ask for it. The `gift-publish` rate limit
  bounds abuse per user.
- **Rollback past schema version `11` is no longer clean on Production.** The previous build parses
  gifts strictly and fails on `entitlement` and `expiresAt`. Once Free gifts exist on Production, a
  rollback makes their `/studio` and `/g` answer `500`. → The runbook gains "Rolling back past
  schema version 11", modelled on version 10. The order of preference is: roll forward, then accept
  the `500`s, then a reviewed one-off script. Soak on `stg` before promoting to `main`.
- **Between the deploy and `db:migrate`, legacy published links answer `404`** (no stored
  `expiresAt`). Their Studio keeps working through the legacy read of Decision 7. → Run `db:migrate` as
  soon as each tier's deployment is `Ready`, as for version 10. Only internal test gifts are
  affected.
- **In-flight idempotency keys.** A key recorded within 24 hours before the deploy has the old
  fingerprint. Replaying it after the deploy answers `409` instead of `201`. → Accepted: it needs a
  lost response straddling a deploy, and the Studio reloads on `409` and shows the published gift.
- **The browser clock disagrees with the server near expiry.** → The display only. The server
  refuses an expired update with `GIFT_EXPIRED`, and the Studio reloads.
- **The internal grant outlives its purpose.** → It is non-Production by construction. The checkout
  change's tasks remove it, or confine it to E2E, when the fake billing provider exists.

## Migration Plan

1. Merge to `dev`, then follow the deployment runbook:
   - in Vercel, rename `INTERNAL_PUBLISH_ENABLED` to `INTERNAL_PLAN_GRANT_ENABLED` on `dev` and `stg`
     (Development and Preview environments only);
   - deploy;
   - run `pnpm db:migrate`, then `pnpm db:verify` and `pnpm db:verify-gifts` against the tier.
2. Smoke test:
   - a Free publish with 3 photos, checking the watermark on `/g`;
   - with the grant on, a Standard publish with 8 photos, checking that there is no watermark;
   - the published panel shows the plan and the expiry.
3. Promote `dev → stg` with the same checks. Promotion to `main` follows the sprint's release
   decision (see Risks).
4. Rollback: see the new runbook section. Re-deploying this version later needs no data repair.
