# Design

## Context

For the why and the scope, see proposal.md. The relevant code at `fcb9a9e`:

- **Layout.** `app/layout.tsx` renders `SiteHeader` and the page; there is no footer. Public routes
  outside the nonce list use the static CSP (`security/content-security-policy.ts`).
- **Publish request.** `PublishGiftRequestSchema` is `{ expectedRevision, planId }.strict()`
  (`packages/contracts/src/gift.ts`). The idempotency fingerprint is
  `["publish", publicId, expectedRevision, planId]`.
- **Publication record.** `GiftPublicationSchema` is strict. Its collection validator allows
  additional properties.
- **Publish step UI.** `studio/publish-step.tsx` renders the confirmation; `publish-action.ts`
  sends the body. The retention label helper `formatRetention` exists in `studio/plan-format.ts`.
- **Cleanup job.** `gift.assets.cleanup.v1` reads the current publication through
  `publications.findByGiftRevision`, then retires detached photos.
- **Owner reads.** `GET /api/gifts/{publicId}` uses `getDraft` with the draft accessors. Owners
  list their photos with signed URLs through the media service (`GET /api/media/assets`).

Governing ADRs: ADR-0005 (route-specific CSP), ADR-0003 (private media, signed URLs), ADR-0010
(analytics off in Production).

## Goals / Non-Goals

**Goals:**

- A notice that states only what the code does.
- A consent that is recorded per publication and enforced by the API, not only by the UI.
- Old published text that stops existing within minutes of an update.

**Non-Goals:** see proposal.md.

## Decisions

### 1. Static privacy page and footer

`app/privacy/page.tsx` is a server component with no data access. The retention table is plain
JSX. `components/site-footer.tsx` sits in the root layout after the page, with one link to
`/privacy`. The sign-in form gains the notice line below its button.

The page stays on the static CSP path. It needs no `connection()`.

### 2. Rights confirmation

- **The contract.** `PublishGiftRequestSchema` gains `rightsConfirmed: z.literal(true)`.
  A missing or `false` value fails the strict parse, so the route answers its existing `400` with
  `fieldErrors.rightsConfirmed`.
- **The fingerprint** is unchanged: the value is always `true`, so retries with the old key stay
  replayable.
- **The publication.** `GiftPublicationSchema` gains an optional `rightsConfirmedAt`, optional
  because publications made earlier have none. `publish` sets it to `publishedAt`.
- **The UI.** `publish-step.tsx` adds a controlled checkbox to both confirmations, reset when the
  confirmation opens, and disables the confirm button until it is checked. `publish-action.ts`
  sends `rightsConfirmed: true`.
- **E2E.** The journeys that publish (`publish.spec.ts`, `publish-update.spec.ts` and
  `gift-journey.ts`) check the box or send the field.

### 3. Retention line

The publish confirmation shows `{formatRetention(retentionDays)}. Bạn có thể tạm dừng hoặc xoá món
quà bất cứ lúc nào.`, for the selected plan offer. The update confirmation does not repeat it,
because the entitlement does not change on an update.

### 4. Superseded publication deletion

`gift-assets-cleanup.ts` gains a publication port, `deleteSuperseded(giftId, currentRevision)`.
The Mongo adapter runs `deleteMany({ giftId, revision: { $lt: currentRevision } })` on
`giftPublications`. The handler calls it right after reading the current publication, and before
deleting photos.

It is idempotent. It cannot remove the current record, because the filter is strictly lower than
the current revision.

A deleted record also means a stale publish key now answers `409` `IDEMPOTENCY_CONFLICT`, which is
the existing safe outcome of `findPublishReplay`.

### 5. Owner export

`GET /api/gifts/{publicId}/export` (`gift-export-route-handler.ts`):

1. **The path.** `PublicGiftIdSchema`, otherwise `404`.
2. **The accessors.** `getGiftRequestContext`.
3. **The read.** `giftExportService.export(publicId, accessors)`:
   - `findAuthorized` with the draft accessors for a draft; only the `user` accessor for a
     published or paused gift;
   - the gift's `ready` assets through the media repository;
   - each photo's largest derivative signed for 300 seconds with `storage.createDownloadUrl`.
4. **The answer.** `200`, with:
   - `Content-Type: application/json; charset=utf-8`;
   - `Content-Disposition: attachment; filename="love-memory-{publicId}.json"`;
   - `Cache-Control: no-store`.

The DTO is built field by field, so no storage key or credential can leak. The Studio aside links
to the route with the `download` attribute. A `GET` is not a mutation, so the JSON guards do not
apply. Rate limiting reuses `gift-update`: export is rare, and that limit is generous.

## Risks / Trade-offs

- **The notice says expired gifts are kept until the owner deletes them.** This is accurate today.
  When the PO sets retention periods for expired gifts and abandoned drafts, the purge job and the
  notice change together.
- **Signed photo URLs in the export expire after five minutes.** The file explains it with a
  `photosNote` field, and the owner can export again.
- **A deleted superseded record makes an old publish key conflict.** The Studio never reuses a key
  after a `201`, so only a hand-crafted retry sees it.

## Migration Plan

No migration. Deploy, then:

1. open `/privacy`;
2. publish a test gift (the checkbox is required);
3. update it and confirm that only one publication record remains;
4. export it.

Rollback: the previous build would refuse nothing and ignore `rightsConfirmedAt`, and old
publications deleted meanwhile stay deleted.
