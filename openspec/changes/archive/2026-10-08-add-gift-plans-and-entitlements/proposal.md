# Proposal

## Why

Publishing is still gated by the Sprint 3 stopgap `INTERNAL_PUBLISH_ENABLED`. Publishing is either
open to every owner or closed to all of them, and it is always closed in Production. Plan.md §14.1
asks for a pricing and entitlement domain. The server must be the source of truth for what a gift
may do: maximum photos, watermark, retention, and password and schedule access. Plan checks must
not be scattered through the UI.

Every later Sprint 5 change builds on this domain:

- checkout prices an order from a plan snapshot;
- a verified payment grants a paid entitlement;
- `gift.expire` acts on the expiry date that the entitlement sets.

Product Owner decisions of 2026-10-08 (Sprint 5 planning) fix the model:

- **Plans.** Two plans:
  - **Free:** at most 3 photos, a small LoveMemory watermark, and a link that works for 14 days.
    It publishes without payment in every environment.
  - **Standard:** 49.000đ per gift. It allows every photo the template allows, has no watermark,
    and the link works for 1 year. Password and scheduled access are included once Sprint 4
    specifies them.
- **Payment.** A gift is paid for once. Later updates of a published gift are free.
- **Scope.** Sprint 5 proceeds before the rest of Sprint 4. Parts that need Sprint 4 features are
  out of scope.
- **Provider.** Payment uses a fake provider first; real payOS onboarding comes later. This change
  contains no payment at all.

## What Changes

- **Plan catalog.** New domain module `packages/domain/src/billing`, holding the versioned plans
  `free@1` and `standard@1`:
  - Each plan lists `priceVnd`, `maxPhotos`, `watermark`, `retentionDays`, `passwordAccess` and
    `scheduledAccess`.
  - A plan version never changes once released. A new price or limit is a new version.
- **Gift entitlement snapshot.** A gift's first publish grants it an entitlement, written in the
  same transaction as the publication.
  - The entitlement copies the plan's values, its id and version, the grant source and the grant
    time.
  - It sets the gift's `expiresAt` to the grant time plus `retentionDays`.
  - Updates of a published gift keep the entitlement and the expiry; they cost nothing.
- **Plan in the publish request.** `POST /api/gifts/{publicId}/publish` takes
  `{ expectedRevision, planId }`, where `planId` is `free` or `standard`. **BREAKING** for API
  clients; the Studio is the only one. New pre-publish refusals, each a `409` `CONFLICT` with a
  `details.reason`:
  - `PLAN_NOT_AVAILABLE`: the plan cannot be granted to this owner. This is always the case for
    `standard` until payment exists, unless the internal grant below is on.
  - `PLAN_CHANGE_UNSUPPORTED`: an update names a plan other than the gift's entitlement. Upgrades
    arrive with payment.
  - `GIFT_EXPIRED`: an update of a gift whose `expiresAt` has passed.
  - `PLAN_PHOTO_LIMIT_EXCEEDED`, with `details.maxPhotos` and `details.photoCount`: the content
    holds more photos than the plan allows.
- **Internal publish entitlement removed.** Owners may always publish on the Free plan.
  - **Deviation from the decision as recorded.** `INTERNAL_PUBLISH_ENABLED` is not simply deleted.
    It is replaced by `INTERNAL_PLAN_GRANT_ENABLED`, which grants the paid plan without payment
    (entitlement source `internal`). It follows the same rules as before: on only when the value is
    exactly `true`, and never on Vercel Production.
  - Without it, the 8-photo publish journey (the Gate M2 evidence) could not run until checkout
    exists. The Sprint 5 checkout change replaces it with the fake billing provider.
- **Expiry on the share link.** A share link is live only while server time is before the gift's
  `expiresAt`. The page and the payload endpoint check it on every request, so a late job can never
  extend access.
  - An expired link gets the same opaque not-found answer as any other dead link. Its copy becomes
    `Món quà không tồn tại, đã hết hạn hoặc đã được thu hồi.`
  - Moving the stored status to `expired` is the `gift.expire` job of a later Sprint 5 change.
- **Watermark.** For a gift whose entitlement has `watermark`, `/g/{shareId}` shows the host-level
  mark `Tạo bằng LoveMemory` over the gift frame, outside the template iframe. The template, its
  payload and the preview are unchanged.
- **Studio.**
  - **First publish.** The `Xuất bản` step offers the two plans, with their limits and price.
    - Free is disabled when the content holds more than 3 photos.
    - Standard is disabled with `Sắp mở thanh toán.` unless the internal grant is on.
    - The publish request carries the chosen plan.
  - **Published gift.**
    - The published panel shows the plan and the date until which recipients can open the gift,
      or that it has expired.
    - `Cập nhật món quà` is disabled for an expired gift or one over its photo limit.
  - The `403` publish copy `Xuất bản chưa được mở cho tài khoản này.` disappears.
- **Draft DTO.** `publication` gains `planId`, `maxPhotos`, `watermark` and `expiresAt`, so the
  Studio reads limits from the server, never from a constant.
- **Database schema version `11`.**
  - The `gifts` validator gains `entitlement` and `expiresAt`.
  - `db:migrate` backfills every published gift without an entitlement with `standard@1`
    (source `legacy`), expiring 365 days after its `publishedAt`. These are internal test gifts,
    published under the internal flag with up to 8 photos.
  - `db:verify-gifts` covers the grant, the kept entitlement on update, and the expired-link
    lookup.

This change belongs to **Sprint 5, Gate M4** (plan.md §14.1). It is the first Sprint 5 change. Job
outbox, system emails, checkout and payment fulfillment follow.

## Non-goals

- **Payment**: orders, checkout, payOS, webhooks, reconciliation, and buying or upgrading to
  Standard. These are later Sprint 5 changes.
- **Renewing or extending** a gift's expiry, and the `expired` stored status. The `gift.expire` job
  and renewal come later; this change only refuses access by server time.
- **A designed "expired" page for recipients**, and expired, paused or deleted envelopes. These
  belong to the Sprint 4 access-policy states.
- **Enforcing `passwordAccess` and `scheduledAccess`.** Both are recorded in the entitlement, but
  only `unlisted` is servable, so every other policy still fails with `ACCESS_POLICY_UNSUPPORTED`.
  Sprint 4 gates those policies by these flags when it specifies them.
- **Per-plan template availability.** Both plans allow every available template; a premium-template
  restriction arrives with a Premium plan.
- **A Premium plan**, coupons and subscriptions (plan.md §17.6 P1–P2).
- **Capping the photo picker by plan.** Upload quotas stay as they are. The plan limit is enforced
  at publish, and the Studio explains it in the `Xuất bản` step.
- **A watermark in the preview**, which shows the creator what the template renders, and an
  analytics property for the plan.
- **Takedown for publicly published Free gifts.** That is Sprint 6. See the risk below; promoting
  to `main` stays governed by the release gates.

## Invariants touched

- **Authorize inside the data-access filter; opaque `404`.** Plan checks run only after the owner
  filter has found the gift, so a non-owner still gets the identical `404`. An expired share link
  is filtered inside the gift lookup (`expiresAt > now`) and answers exactly like an unknown one.
- **DTOs only.** The publication summary adds plan values and dates only: no internal ids, no grant
  source.
- **Long-running work through the outbox.** No new background work. Expiry is a per-request
  comparison; the status transition is left to the later `gift.expire` job.
- **Published gifts pin an exact template version.** Unchanged. The entitlement pins the exact
  plan version in the same way, and the catalog is never re-read to interpret a granted gift.
- **Protected payloads never in public caches; nonce CSP on private routes.** No new route. The
  watermark flag is rendered by the already dynamic `/g` page and is not gift content.
- **Publish and payment are idempotent; only a verified webhook or reconciliation marks an order
  paid.** Replays keep returning the first publication. The plan id becomes part of the request
  fingerprint, so replaying a key with another plan answers `409`. No path in this change marks
  anything paid. The internal grant is refused on Production and is recorded as source `internal`,
  never as a payment.
- **Never log gift text.** The new refusal details hold only counts and plan ids.
- **Recipients need no account; no-audio and reduced-motion paths.** Unchanged. The watermark is
  static text.

## Capabilities

### New Capabilities

- `gift-plans`: the plan catalog (`free@1`, `standard@1`), the gift entitlement snapshot and its
  expiry, plan availability per owner, and the internal paid-plan grant.

### Modified Capabilities

- `gift-publishing`:
  - the publish body gains `planId`, and the internal publish entitlement step is removed
    (REMOVED "Internal publish entitlement");
  - pre-publish checks gain the plan, expiry and photo-limit refusals;
  - the snapshot write grants the entitlement and sets `expiresAt`;
  - the response carries `planId` and `expiresAt`;
  - the Studio panel shows the plan and the expiry.
- `public-gift-viewer`: liveness requires `expiresAt` later than server time; the not-found copy
  names expiry; the page shows the watermark for watermarked entitlements.
- `gift-drafts`: the publication summary in the draft DTO gains `planId`, `maxPhotos`, `watermark`
  and `expiresAt`.
- `studio-editor`: plan choice in the `Xuất bản` step, the plan-related disabled states and
  messages, and the removed internal-entitlement copy.
- `database-schema-management`:
  - the `gifts` validator gains `entitlement` and `expiresAt`;
  - schema version `11` with the legacy backfill;
  - `db:verify-gifts` covers entitlements and expiry.

## Impact

- **Domain:**
  - new `packages/domain/src/billing` (`plan.ts`, `gift-entitlement.ts`);
  - `GiftSchema` gains `entitlement` and `expiresAt`;
  - `publishGiftDraft` takes the granted entitlement;
  - a photo count helper beside `listImageFieldReferences` in `packages/template-sdk`.
- **Contracts:** `PublishGiftRequestSchema` (`planId`), `GiftPublicationDtoSchema` and
  `GiftPublicationSummarySchema` (plan fields), and a `PlanOfferDto` for the Studio page.
- **Application:**
  - in `gift-service.ts`, `PublishEntitlement` is replaced by a `PlanGrantPolicy` port, and
    `publishGift` gains the new checks;
  - in `public-gift-service.ts`, the lookup filters on `expiresAt` and returns `watermark`.
- **Infrastructure:**
  - `mongo-gift-repository.ts`: the conditional publish write sets `entitlement` and `expiresAt` on
    a first publish, and `toDomain` reads them;
  - the public gift lookup filters on `expiresAt`;
  - `packages/database/src/migrations.ts` moves to version `11`;
  - `scripts/verify-gift-persistence.ts`.
- **Configuration:**
  - `apps/web/src/config/internal-publish.ts` becomes `internal-plan-grant.ts`
    (`INTERNAL_PLAN_GRANT_ENABLED`);
  - `.env.example`, `playwright.config.ts` and each Vercel tier rename the variable.
- **Presentation:**
  - the Studio page, `publish-step.tsx`, `publish-action.ts`, `published-panel.tsx` and
    `draft-editor.tsx`;
  - `public-gift-screen.tsx` and the `/g` page (watermark);
  - `app/g/[shareId]/not-found.tsx` (copy).
- **E2E:**
  - `publish.spec.ts` publishes on Standard through the internal grant;
  - `publish-update.spec.ts` publishes on Free and asserts the watermark;
  - a new case shows Free disabled for 4 photos.
- **Docs:**
  - `docs/architecture.md` (entitlement section);
  - a new ADR-0011 "Plans are versioned code constants snapshotted into gifts";
  - the deployment runbook (variable rename and schema version `11` rollback);
  - the risk register: public Free publishing before takedown exists;
  - `docs/sprints/sprint-5-plan.md` with the sprint split and the PO decisions.
- **No new dependency or route.**
