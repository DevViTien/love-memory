# Proposal

## Why

Gate M2 (plan.md §12.4, §12.6 and §12.7) needs the vertical slice to end in a real, shareable
gift: "Một người không thuộc đội kỹ thuật tạo được gift thật trên staging. Một người khác mở được
bằng anonymous browser", pinned to an immutable template version, with preview and published
content identical. Today a draft can be created, edited, uploaded to and previewed, but nothing can
publish it:

- `GIFT_TRANSITIONS` allows `draft → publishing → published`, yet no code performs it.
- The Studio's `Xuất bản` step shows a disabled button with `Sắp ra mắt`.
- `/g` is already mapped to the nonce CSP, but no route exists under it.
- Media routes let the owner delete any asset at any time, which would break a published gift.

The four earlier Sprint 3 changes deliver everything this change builds on: the `memory-box@1.1.0`
artifact (`add-memory-box-template`), the step-based Studio with `flush()`
(`add-schema-driven-studio`), local object storage for E2E uploads (`add-local-object-storage`),
and the shared payload builder `buildViewerPayload` plus the `GiftViewer` host with a deferred
source (`add-gift-preview`). This change connects them with a temporary, internal, free publish.

## What Changes

- Add `POST /api/gifts/{publicId}/publish`:
  - it takes an `Idempotency-Key` UUID header and the strict body `{ expectedRevision }`;
  - it applies the mutation guards and the new rate-limit scope `gift-publish`;
  - only the signed-in owner may publish. A request without a session gets `401`. Anyone else,
    including a holder of the anonymous cookie of an unclaimed draft, gets the opaque `404`;
  - an internal free entitlement gates it: the server flag `INTERNAL_PUBLISH_ENABLED=true`, off by
    default and always off when `VERCEL_ENV` is `production`. With the flag off, an authorized owner
    gets `403` `FORBIDDEN`, and non-owners still get `404` first.
- Publish checks, in order:
  - the gift is a `draft` and its revision equals `expectedRevision` (`409` `CONFLICT`
    otherwise);
  - the access policy is `unlisted`, the only one served so far (fails closed with `409`
    otherwise);
  - the bound template version is editable and has a registered artifact (`409` `CONFLICT` with a
    `details.reason` otherwise);
  - the content has no content issue, using the same checks as the preview's server issues
    (`viewer-payload` "Content issues"): full payload rules, every referenced asset `ready` and
    owned by the gift and field, and a selectable audio track. Otherwise it answers `400`
    `VALIDATION_ERROR` with `fieldErrors`.
- One MongoDB transaction:
  - inserts an immutable `giftPublications` snapshot (`giftId`, `shareId`, `revision`,
    `templateId`, `templateVersion`, `artifactContentHash`, `content`, `assetIds`,
    `audioTrackId`, `publishedAt`);
  - moves the gift `draft → publishing → published` through domain transition functions, and sets
    `shareId` and `publishedAt`;
  - re-checks the referenced assets inside the transaction;
  - records the idempotency key.

  A replay with the same key and body returns the same `201` result. A replay with another body,
  or by another actor, gets `409`.

- `shareId`: 16 random bytes as a 22-character base64url string, with unique indexes. The public
  URL is `/g/{shareId}`.
- Publishing ends draft-only access: draft APIs and preview links already stop at non-drafts. Media
  routes now answer `404` for assets of non-draft gifts. Asset deletion becomes atomic with the
  gift still being a draft, so a concurrent publish can never lose a photo.
- Add the public Viewer page `/g/{shareId}`:
  - nonce CSP, a layout that calls `connection()`, and `Cache-Control: private, no-store`,
    `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`;
  - generic title and Open Graph metadata without gift text;
  - a server-rendered envelope without gift content, and `GiftViewer` with a deferred source.
- Add `GET /api/public-gifts/{shareId}`: `no-store`, and rate limited per network subject and share
  id (`public-gift-read`, 60 per 600 s) plus a looser per-network cap (`public-gift-read-ip`, 600
  per 600 s), with IPv6 bucketed by `/64`, so that recipients behind one carrier-grade NAT address
  do not share one budget. It returns the `buildViewerPayload` result for the publication
  snapshot, pinned to its `artifactContentHash`, without `issues`. Unknown, malformed or no longer
  published share ids get an opaque `404` and the page `Món quà không tồn tại hoặc đã được thu hồi.`
- Studio:
  - The `Xuất bản` step becomes real. It shows a sign-in or claim prompt for anonymous drafts, the
    readiness summary, and a note when publishing is not enabled. `Xuất bản` awaits `flush()` and
    publishes the last saved revision. Clear messages cover every failure.
  - On success, and whenever the owner opens `/studio/{publicId}` of a published gift, the Studio
    shows a `Đã xuất bản` panel with the share link and a copy button instead of the editor. The
    draft APIs keep answering `404` for non-drafts.
- Migrate the database to schema version `8`:
  - the new collection `giftPublications` with its validator and indexes;
  - the `gifts` validator gains optional `shareId` and `publishedAt`, and a unique index on
    `shareId`;
  - the `apiRateLimits` scope enum gains `gift-publish`, `public-gift-read` and
    `public-gift-read-ip`.
- Add an E2E journey (run by the coordinator, on local object storage): create → upload →
  customize → preview → sign in and claim → publish → open `/g/{shareId}` in an anonymous context.

This change belongs to **Sprint 3, Gate M2** (plan.md §12.4). It is the fifth Sprint 3 change,
archived in this order: `add-memory-box-template`, `add-schema-driven-studio`,
`add-local-object-storage`, `add-gift-preview`, `add-temporary-gift-publish` (this change),
`add-funnel-analytics`.

## Non-goals

- Payment, orders and paid entitlements (Sprint 4–5, ADR-0009). The flag is a stand-in for an
  entitlement, not a pricing decision.
- QR codes, Web Share, printable share cards (plan.md §13.3).
- Password and scheduled access, pause/resume, expiry, revoke and delete of published gifts
  (plan.md §13.1–13.2). A published gift stays `published` in this change.
- Re-publishing edits as a new revision. A published gift is read-only in the Studio.
- An owner dashboard or a list of published gifts.
- The publish outbox, publishing retries and a persisted `publishing` state. Nothing asynchronous
  happens on publish yet.
- Funnel analytics such as `publish_clicked`, `gift_published` or `gift_open_interaction`
  (`add-funnel-analytics`).
- Social preview images. Metadata stays generic.

## Capabilities

### New Capabilities

- `gift-publishing`: publishing a draft. It covers:
  - the publish endpoint, its authorization and the internal entitlement flag;
  - pre-publish checks and their error mapping;
  - the immutable publication snapshot and the `draft → publishing → published` transition;
  - share id format and uniqueness;
  - idempotent replay;
  - what publishing ends (draft APIs, preview links, media operations);
  - the owner's view of a published gift in the Studio.
- `public-gift-viewer`: how a recipient opens a published gift. It covers:
  - the `/g/{shareId}` page, its headers, metadata and envelope without content;
  - the public payload endpoint pinned to the snapshot, and its rate limit;
  - opaque not-found for unknown and unpublished share ids.

### Modified Capabilities

- `studio-editor`: "Studio preview and publish steps". The `Xuất bản` action becomes available:
  sign-in or claim prompt, readiness, flush, publish, failure messages and the published panel.
- `gift-drafts`: "Read a draft". `/studio/{publicId}` shows the published panel to the owner of a
  published gift instead of the not-found page. The draft API is unchanged.
- `gift-draft-ownership`: "Draft authorization". Publishing is authorized by the signed-in owner
  only. Anonymous credentials never authorize publishing.
- `media-upload`:
  - "Gift-bound asset authorization": every media operation requires a `draft` gift;
  - "Asset deletion": the move to `deleting` is atomic with the gift still being a draft.
- `mutation-request-guards`: "Distributed mutation rate limits". Adds the `gift-publish` scope,
  10 requests per 600 seconds.
- `content-security-policy`: "Nonce routes are dynamically rendered". The `/g` route tree opts out
  of prerendering.
- `database-schema-management`:
  - "Collection registry", "JSON-schema validators", "Named indexes", "Idempotent migration with
    ledger" and "Schema verification": `giftPublications`, the `gifts` share fields and index, the
    three scopes and schema version `8` (also from version `6` in one step);
  - "Gift persistence verification": `db:verify-gifts` also exercises publish, its replay and a
    stale-revision publish against real MongoDB.

## Impact

- **Invariants touched**:
  - _Authorize inside the data-access filter; non-owners get an opaque 404_:
    - the publish lookup filters by `publicId` and `ownership.ownerId`, and the publish write
      filters again by owner, `status: "draft"` and `revision`;
    - public reads filter by `shareId`, `status: "published"` and `access.mode: "unlisted"`, and
      also require the publication record;
    - every not-found cause answers the same `404` or not-found page;
    - the flag's `403` is sent only after ownership is proven.
  - _Return DTOs, never raw documents; storage keys never reach the browser; downloads use
    short-lived signed URLs_:
    - publish returns a publication DTO (`publicId`, `status`, `shareId`, `sharePath`,
      `publishedAt`, `revision`);
    - the public endpoint returns the viewer payload DTO only (no `issues`, no asset records);
    - signed URLs for a published gift are issued only by that endpoint, after the liveness check.
  - _A published gift pins an exact template version and content snapshot_:
    - the snapshot stores `templateId`, `templateVersion` and the artifact `contentHash`;
    - public reads pass that hash as `expectedContentHash`, so a changed artifact falls back to the
      static rendering instead of running different code;
    - the snapshot is never updated.
  - _Publish is idempotent_: an `Idempotency-Key` stored in the publish transaction, replay
    returns the same publication, and a unique owner/status/revision write prevents double
    publication.
  - _Protected gift payloads never enter public caches; private routes use nonce CSP and
    `connection()`_:
    - `/g` uses the nonce CSP and its layout calls `connection()`;
    - the page and the payload endpoint are `no-store`, `noindex` and `no-referrer`;
    - the envelope carries no gift content.
  - _Never log gift text, tokens or signed URLs_: share ids are bearer links. Route failures log
    only an event name and the request id, and the development request log ignores `/g/` and
    `/api/public-gifts/`. Hosting platform request logs still record `/g/{shareId}`, and a link
    cannot be revoked until Sprint 4. This residual risk is documented, with who can read those
    logs and how long they are kept (design Risks).
  - _Recipients need no account; audio only after a gesture; reduced-motion and no-audio paths_:
    `/g` needs no session and reuses `GiftViewer`, whose audio starts in the `Mở quà` gesture.
  - _Long-running or retryable work goes through the outbox_: publish does no asynchronous work in
    this change, so no job is added (see Non-goals).
- **Code**:
  - `packages/domain`: `ShareIdSchema`, the `GiftSchema` share fields, `publishGiftDraft`,
    `GiftPublicationSchema`;
  - `packages/contracts`: publish request and response schemas, and `ViewerPayloadDtoSchema` for
    the public endpoint;
  - `packages/database`: `COLLECTIONS.giftPublications`, validators, indexes and version `8`;
    `scripts/verify-gift-persistence.ts` gains the publish checks;
  - `apps/web/src/modules/gifts`: publish service, repository transaction, entitlement port,
    publish rate-limit scope, Studio publish action and published panel;
  - new `apps/web/src/modules/public-gifts`: public read service and route handler;
  - `apps/web/src/modules/viewer`: the content-issue computation is exported on its own, so
    publish reuses it without signing URLs;
  - `apps/web/src/modules/media`: draft-only media operations, and an atomic delete;
  - `apps/web/src/config/internal-publish.ts` (new), `apps/web/src/composition/*`;
  - `app/api/gifts/[publicId]/publish/route.ts`, `app/api/public-gifts/[shareId]/route.ts`,
    `app/g/layout.tsx`, `app/g/[shareId]/page.tsx`, `app/g/[shareId]/not-found.tsx`,
    `app/studio/[publicId]/page.tsx`;
  - `apps/web/next.config.ts` (`/g/:path*` headers and log ignores, additive);
  - `playwright.config.ts` (`INTERNAL_PUBLISH_ENABLED: "true"`) and `apps/web/e2e/publish.spec.ts`.
- **Docs**: `docs/architecture.md` ("Publishing and the public Viewer", with the schema `8`
  rollback note), `.env.example` and `docs/runbooks/preview-deploy-and-rollback.md` (the
  `INTERNAL_PUBLISH_ENABLED` variable per environment).
- **APIs**: new `POST /api/gifts/{publicId}/publish`, `GET /api/public-gifts/{shareId}` and the
  page `/g/{shareId}`. No existing route or DTO changes shape. Media routes answer `404` for
  non-draft gifts, which no current client relies on.
- **Data**:
  - the new collection `giftPublications`;
  - `gifts` documents of published gifts gain `shareId` and `publishedAt`;
  - `apiRateLimits` scopes gain `gift-publish`, `public-gift-read` and `public-gift-read-ip`;
  - `DATABASE_SCHEMA_VERSION` goes from `7` to `8`.

  The migration is additive, and no existing document changes.

- **Dependencies**: none added.
