# Proposal

## Why

Today a published gift is frozen. The Studio shows only the `Đã xuất bản` panel, the draft and
media APIs answer `404`, and a typo found after sending can be fixed only by making a new gift and
sending a new link. That breaks the QR code already printed on a physical gift. Plan.md §13.1 asks
for "Publish revision mới khi owner sửa", and Product Owner decision P6
(`docs/sprints/sprint-3-review.md` §3) chose revision snapshots behind a stable `/g/{shareId}`.

Every later Sprint 4 change builds on this model. QR codes and the dashboard need a link that
survives edits. Pause, resume and delete act on the same publication record.

## What Changes

- **Edit after publish.** A published gift stays `published`. Its owner can keep editing it in the
  Studio, and the gift's `content` and `revision` become a working copy.
  - Recipients keep seeing the gift's current publication, until the owner chooses
    `Cập nhật món quà`.
  - Only the signed-in owner can edit. A published gift is always owned, so the anonymous cookie
    never reaches it.
- **Republish as a new publication.** The existing `POST /api/gifts/{publicId}/publish` also
  accepts a `published` gift.
  - It requires `expectedRevision` to be newer than the current publication's revision. Otherwise
    it answers `409` `CONFLICT` with `details.reason` `NO_UNPUBLISHED_CHANGES`.
  - It inserts a new immutable `giftPublications` record with the same `shareId`, through the new
    domain edge `published → publishing`.
  - It switches the gift's new `publishedRevision` pointer in the same transaction, so recipients
    see either the old publication or the new one, never a mix.
  - All pre-publish checks (template version, artifact, content issues, assets `ready`) apply
    unchanged.
- **Stable share id.** The `shareId` is assigned at the first publish and kept by every later
  publication of the gift. Share ids stay unique across gifts. The unique index on
  `giftPublications.shareId` is dropped, because one gift now has several publication records.
- **Public viewer reads the current publication.** `/g/{shareId}` and
  `GET /api/public-gifts/{shareId}` serve the publication whose revision equals the gift's
  `publishedRevision`. Superseded publications are kept but never served.
- **Idempotency fix (debt D5).** A replayed publish key returns the publication of that request's
  revision, looked up by `{ giftId, revision }`, not "any publication of the gift". After a `201`,
  the Studio uses a new `Idempotency-Key` for the next update.
- **Draft, preview and media APIs accept published gifts for the owner.**
  - `GET` and `PATCH /api/gifts/{publicId}`, preview links, upload initialization and completion,
    listing, reading and retry work for `draft` and `published` gifts.
  - The draft DTO gains `status` `published` and a `publication` summary.
  - Claiming stays draft-only.
- **Photos of the live publication are protected.** Deleting an asset that the current
  publication references detaches it from the working copy instead of deleting it.
  - Its storage objects and `ready` status are kept for recipients.
  - It frees its quota slots and can no longer be listed, read, retried or referenced by a save.
  - The response is `200` with `deleted` `false`.
  - The detach is atomic with a concurrent republish.
- **Studio.** `/studio/{publicId}` of a published gift shows the published panel above the editor.
  - The panel holds the share link, `Sao chép liên kết` and `Mở món quà`, plus whether there are
    unpublished changes.
  - The `Xuất bản` step offers `Cập nhật món quà` with its own confirmation, and is disabled
    while nothing changed.
  - The first-publish texts no longer say the gift cannot be edited.
- **Analytics.** `gift_published` stays a first-publish event: updates record nothing. The Studio
  still sends no funnel events for a published gift, including while it is being edited.
- **Database schema version `10`.**
  - The `gifts` validator gains `publishedRevision`; the `assets` validator gains `detachedAt`.
  - `gift_publications_share_id_unique` becomes a legacy index that migrations drop.
  - `db:migrate` backfills `publishedRevision = revision` for already published gifts, which could
    not have been edited.
  - `db:verify-gifts` covers republish, replay by revision and detach-versus-republish.

This change belongs to **Sprint 4, Gate M3** (plan.md §13.1). It is the first Sprint 4 change, and
QR/share, pause/resume/delete, access policies and the dashboard build on it.

## Non-goals

- **Discarding unpublished changes** (`Hủy thay đổi`, restoring the working copy to the current
  publication). This is a P1 Studio item, deferred by the Product Owner.
- **Choosing or rolling back to an older publication.** Superseded publications are history only.
- **Upgrading a published gift to a newer template version.** Every publication pins the bound
  version, as today.
- **A publish outbox, `publish.finalize`, a persisted `publishing` state or background retries.**
  Publish stays one synchronous transaction, and the client retries with the same key. The outbox
  arrives with its first consumer: payment fulfillment, QR or e-mail (Sprint 5, ADR-0008).
- **Cleaning up detached or superseded assets.** They stay in storage until the `asset.cleanup`
  job (plan.md §14.4) or the deletion work of Sprint 6. Each publish is rate limited, which bounds
  how many can pile up.
- **Pause, resume, delete, revoke, expiry, password and scheduled access, QR, the dashboard.**
  These are later Sprint 4 changes. Access stays `unlisted` only.
- **Notifying recipients that a gift changed**, and a `gift_updated` analytics event (part of PO
  decision P11).
- **A per-actor namespace for idempotency keys** (the second half of debt D5). Keys remain unique
  per scope; a collision needs a key that someone else already chose, and it only yields `409`.
- **Debt D4** (validator `anyOf` per status, migration downgrade guard, index rebuild under a
  temporary name). This change uses the existing legacy-index mechanism.

## Invariants touched

- **Authorize inside the data-access filter; opaque `404`.** Editing, previewing, uploading and
  republishing a published gift use the existing owner filters. Every query and conditional write
  adds the status set `draft` or `published`. Non-owners, other statuses and anonymous cookies
  still get the same `404`.
- **DTOs only; assets by ID; no raw URLs.** The draft DTO adds a `publication` summary (share id,
  share path, time, revision) and nothing internal. Publications keep referencing assets by id.
  Signed URLs are still issued per request.
- **No image bytes in MongoDB.** The working copy and publications hold asset ids only.
- **Long-running work through the outbox.** Nothing new is long-running: detaching an asset
  removes no storage object. Removing detached assets is left to a later outbox job.
- **Published gifts pin an exact template version; template releases are immutable.** Each
  publication pins `templateVersion` and `artifactContentHash` as before. A new publication never
  changes an earlier one.
- **Protected payloads never enter public caches; nonce CSP on private routes.** No new route.
  `/g`, `/preview` and `/studio` keep their headers and dynamic rendering.
- **Publish is idempotent.** Replays are keyed by request revision. Concurrent updates produce at
  most one publication per revision (`gift_publications_gift_revision_unique`).
- **Never log gift text or share links.** Unchanged; the new error reason holds no content.
- **Recipients need no account.** Unchanged. A recipient who opens the link after an update sees
  the new publication.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gift-publishing`: republishing a published gift.
  - Pre-publish checks gain the `NO_UNPUBLISHED_CHANGES` reason.
  - The snapshot write switches `publishedRevision`.
  - The share id is kept across publications.
  - Idempotent replay is keyed by revision.
  - "Publishing ends draft access" is replaced by "Editing a published gift".
  - The Studio panel shows unpublished changes.
- `public-gift-viewer`: liveness and the payload use the gift's current publication.
- `gift-drafts`: the draft API reads and saves a published gift's working copy, and the DTO gains
  `published` and `publication`.
- `gift-draft-ownership`: draft and preview authorization cover the owner's published gifts.
- `gift-preview`: preview links can be issued and opened for a published gift's working copy.
- `media-upload`: media operations are allowed on the owner's published gifts. Assets in the
  current publication are detached, not deleted. Detached assets leave quotas, listings and save
  references.
- `studio-editor`: the published panel above the editor, `Cập nhật món quà` and its confirmation,
  updated first-publish texts, and a new idempotency key after each success.
- `funnel-analytics`: `gift_published` excludes updates, and no Studio events are sent while a
  published gift is edited.
- `database-schema-management`:
  - validators for `publishedRevision` and `detachedAt`;
  - the index list drops `gift_publications_share_id_unique`;
  - schema version `10` with the backfill;
  - `db:verify-gifts` covers republishing.

## Impact

- **Domain** (`packages/domain/src/gift`):
  - the `published → publishing` transition;
  - `publishedRevision` in `GiftSchema`;
  - `republishGift` beside `publishGiftDraft`;
  - draft updates allowed on `published` gifts.
- **Media domain** (`packages/domain/src/media`): `detachedAt` on `MediaAsset`.
- **Application** (`apps/web/src/modules/gifts`, `media`, `preview`, `public-gifts`):
  - `gift-service.ts`: publish, update, read, the Studio view and DTOs;
  - `media-service.ts`: authorization and deletion becoming a detach;
  - `preview-service.ts`: the status filter;
  - `public-gift-service.ts`: the current-publication lookup.
- **Infrastructure:**
  - `mongo-gift-repository.ts`: conditional writes, replay by revision;
  - `mongo-gift-publication-repository.ts`: `findByGiftRevision` replaces `findByShareId`;
  - `mongo-media-repository.ts`: `markDeleting` becomes a detach-or-delete, and quotas and
    listings exclude detached assets;
  - `packages/database/src/migrations.ts`: version `10`, validators, the legacy index and the
    backfill;
  - `scripts/verify-gifts` (`db:verify-gifts`).
- **Presentation:**
  - `apps/web/src/app/studio/[publicId]/page.tsx`;
  - `published-panel.tsx`, the Studio publish step, `media-image-list-field.tsx` (accepting
    `deleted: false`);
  - the Studio analytics wiring.
- **E2E:** extend `apps/web/e2e/publish.spec.ts` with edit → update → recipient sees the new
  content at the same link. Add a detach test for photos that the live publication uses.
- **Docs:**
  - `docs/architecture.md`: the publication model;
  - the deployment runbook: run schema version `10` with `db:migrate`;
  - `docs/sprints/sprint-3-review.md`: record P6 and D5 as resolved;
  - the risk register: detached assets accumulate until cleanup.
- **No new dependency, route or environment variable.**
