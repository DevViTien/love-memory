# Design

## Context

See proposal.md for why this change exists. This design assumes the four earlier Sprint 3 changes
are archived and merged: `add-memory-box-template`, `add-schema-driven-studio`,
`add-local-object-storage` and `add-gift-preview`. Here is the state it builds on.

**Gift domain and persistence.**

- `packages/domain/src/gift/gift-status.ts` defines `GIFT_STATUSES`, `GIFT_TRANSITIONS`
  (`draft → publishing`, `publishing → published`) and `transitionGift`. No code calls it yet.
- `GiftSchema` (`gift-schema.ts`) is `.strict()`. `mongo-gift-repository.ts` parses every document
  with it (`toDomain`), so a document with an unknown field such as `shareId` would fail to load.
- `mongo-gift-repository.ts` already has the patterns this change needs:
  - `createDraft` runs a transaction that replays or records an `idempotencyKeys` document
    (`_id: "{scope}:{key}"`, `actorKey`, `giftId`, `requestFingerprint`, 24 h `expiresAt`). A
    duplicate-key error re-reads the record outside the transaction;
  - `updateDraft` writes with the filter `{ ...accessFilter, _id, revision, status: "draft" }`
    and inserts the `giftRevisions` row in the same transaction;
  - `validateMediaReferences` reads `assets` by gift, field and status.
- `gift-service.ts` returns `GiftServiceResult`s. `gift-route-helpers.ts` maps
  `NOT_AUTHENTICATED` → `401`, `NOT_FOUND` → `404`, `INVALID_STATE` → `409` without details,
  `REVISION_CONFLICT` → `409` with details, `INVALID_CONTENT` → `400` with `fieldErrors`. It also
  provides `getGiftRequestContext`, `enforceGiftMutationRateLimit` and `requestId`. The claim route
  shows the guard order (mutation guards, path, rate limit, body, service).
- `mongo-gift-rate-limiter.ts` holds `GiftMutationScope`, `RATE_LIMITS`,
  `consumeGiftMutationRateLimit` (keyed HMAC subjects, ×5 for shared buckets) and the private
  `networkSubject(request)`.

**Media.** `media-service.ts` authorizes through `authorizeGift(publicId, accessors)`. Only
`initializeUpload` checks `gift.status === "draft"`. `deleteAsset` calls
`assets.markDeleting(assetId, now)` (a single `findOneAndUpdate`), and `retryAsset` calls
`assets.requeue`, neither of which knows the gift status.

**Viewer and preview (after `add-gift-preview`).**

- `modules/viewer/application/build-viewer-payload.ts`: `buildViewerPayload(input, deps)` with
  `expectedContentHash`, the ports `resolveArtifact`, `signDownloadUrl` and `findSelectableTrack`,
  and the output `{ artifactUrl, payload, assets, assetsExpireAt, audioUrl, fields, issues }`.
  `ViewerSource` has `{ kind: "deferred"; load }`.
- `modules/viewer/presentation/gift-viewer.tsx` is the host. It has no preview-specific props, and
  its lifecycle notifications are optional.
- `composition/viewer.ts` wires the payload ports. `AudioCatalogService.findSelectableTrack` exists.
- The `/preview` tree shows the page pattern: `layout.tsx` with `connection()`, `force-dynamic`,
  metadata with `robots` noindex, a `next.config.ts` `headers()` entry and a
  `logging.incomingRequests.ignore` pattern.
- The root `app/loading.tsx` makes `notFound()` stream with status `200` (Next.js 16, "Status
  Codes" in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`).
  A `not-found.tsx` in a segment handles `notFound()` thrown by that segment's page.

**Studio (after `add-schema-driven-studio` and `add-gift-preview`).**

- `studio-steps.ts` resolves the template steps plus `preview` and `publish`.
- `readiness-step.tsx` renders both Studio steps. The autosave controller exposes
  `flush(): Promise<FlushResult>` (`saved` carries `revision`) and `getLastSavedRevision()`. The
  store maps server `fieldErrors` to fields by the first path segment and has a `readOnly` path.
- `app/studio/[publicId]/page.tsx` loads the draft with `giftService.getDraft` and calls
  `notFound()` for anything that is not an authorized draft. The claim UI (`ClaimDraftButton`, the
  `Đăng nhập để lưu lâu dài` link) lives in the page's aside.

**Configuration and tests.** `config/technical-spikes.ts` shows the env flag pattern (Zod,
`"true"`/`"false"`, forced off when `VERCEL_ENV === "production"`). `playwright.config.ts` runs
`next start` on port 3100 with an `_e2e` database, `MEDIA_WORKER_MODE=inline`, an auth e-mail
capture file and, after `add-local-object-storage`, `STORAGE_DRIVER=local`.

**Governing ADRs.**

- **ADR-0001** (modular monolith): a new `public-gifts` module, wired only in `composition/`.
- **ADR-0002** (native driver): explicit filters, one multi-document transaction, unique indexes.
- **ADR-0003** (private object storage): published assets stay private. Short-lived signed URLs
  are issued only by the public payload endpoint.
- **ADR-0004** (template artifact isolation): a publication pins the version and the artifact
  `contentHash`. The public Viewer reuses the sandboxed `GiftViewer`.
- **ADR-0005** (route CSP modes): `/g` is already a nonce route. Its layout calls `connection()`.
- **ADR-0009** (billing boundary): the internal flag sits behind an entitlement port, so Sprint 4
  can replace it with a real entitlement (verified payment) without touching the publish flow.

No decision contradicts an accepted ADR.

## Goals / Non-Goals

**Goals:**

- One publish is one transaction. A published gift can never reference a missing or non-ready
  asset, and a retried request can never publish twice.
- "Preview == published" by construction: the publish checks are the preview's server issues, and
  the public endpoint calls the same `buildViewerPayload` on the same content.
- The public page leaks nothing before the tap: no gift text in HTML, metadata, logs or caches.
- Keep logic in `.ts` files with unit tests (domain, services, repositories, route handlers,
  Studio action). `.tsx` files only render.

**Non-Goals:**

- A generic entitlement or billing model. The port has one method and one implementation.
- Changing `buildViewerPayload`'s output or `GiftViewer`'s behavior. Only a pure part of the
  builder is exported for reuse (D5).
- Persisting `publishing`, retrying publishes in the background, or an outbox event.

## Decisions

### D1. Module layout

| Path                                                                                     | Kind           | Responsibility                                                                                                                                                       |
| ---------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain/src/gift/gift-identity.ts`                                              | pure           | `ShareIdSchema` (`^[A-Za-z0-9_-]{22}$`).                                                                                                                             |
| `packages/domain/src/gift/gift-schema.ts`                                                | pure           | `GiftSchema` gains optional `shareId` and `publishedAt` with a status invariant (D2).                                                                                |
| `packages/domain/src/gift/gift-publication.ts`                                           | pure           | `publishGiftDraft`, `GiftPublicationSchema`, `createGiftPublication` (D2).                                                                                           |
| `packages/contracts/src/gift.ts`                                                         | schemas        | `PublishGiftRequestSchema`, `GiftPublicationDtoSchema`, `GiftPublicationResponseSchema` (D11).                                                                       |
| `packages/contracts/src/viewer.ts` (new)                                                 | schemas        | `ViewerPayloadDtoSchema` (no `issues`) and `PublicGiftResponseSchema` (D11).                                                                                         |
| `apps/web/src/config/internal-publish.ts`                                                | config         | `parseInternalPublishEnvironment`, `getInternalPublishEnvironment` (D3).                                                                                             |
| `modules/gifts/application/gift-service.ts`                                              | service        | `publishGift` (D4) and `getStudioGift` (D10); new ports `PublishEntitlement`, `GiftArtifactResolver`, `GiftPublicationRepository`, media listing for content checks. |
| `modules/gifts/infrastructure/mongo-gift-repository.ts`                                  | infrastructure | `publishDraft` transaction (D6), `findPublishedByShareId`.                                                                                                           |
| `modules/gifts/infrastructure/mongo-gift-publication-repository.ts`                      | infrastructure | `findByShareId` (replays read the publication by gift id inside `mongo-gift-repository.ts`).                                                                         |
| `modules/gifts/presentation/publish-route-handler.ts`                                    | presentation   | `POST` handler (D4). `app/api/gifts/[publicId]/publish/route.ts` re-exports it.                                                                                      |
| `modules/gifts/presentation/studio/publish-action.ts`                                    | pure           | `requestPublish(...)` → outcome (D10).                                                                                                                               |
| `modules/gifts/presentation/studio/publish-step.tsx`, `published-panel.tsx`              | React          | The `Xuất bản` step and the published panel.                                                                                                                         |
| `modules/viewer/application/content-issues.ts`                                           | pure           | `collectContentIssues` and `issuesToFieldErrors`, extracted from the builder (D5).                                                                                   |
| `modules/public-gifts/application/public-gift-service.ts`                                | service        | `isLiveShare(shareId)` and `openPublicGift(shareId)` (D8).                                                                                                           |
| `modules/public-gifts/presentation/public-gift-route-handler.ts`                         | presentation   | `GET` handler (D8). `app/api/public-gifts/[shareId]/route.ts` re-exports it.                                                                                         |
| `modules/public-gifts/presentation/load-public-gift.ts`                                  | pure           | The deferred `load` for `GiftViewer` (D9).                                                                                                                           |
| `modules/public-gifts/presentation/public-gift-screen.tsx`                               | React          | Mounts `GiftViewer` with the deferred source.                                                                                                                        |
| `modules/media/application/media-service.ts`, `infrastructure/mongo-media-repository.ts` | service        | Draft-only operations and the atomic `markDeleting` (D7).                                                                                                            |
| `composition/gifts.ts`, `composition/public-gifts.ts` (new), `composition/media.ts`      | wiring         | Entitlement from config, artifact resolver from the registry, the viewer ports from `composition/viewer.ts`.                                                         |
| `app/g/layout.tsx`, `app/g/[shareId]/page.tsx`, `app/g/[shareId]/not-found.tsx`          | routes         | D9.                                                                                                                                                                  |

`modules/public-gifts` depends on `modules/viewer` and on the gifts application ports, never on
`modules/preview`. Cross-module application imports follow the existing precedent (`media-service`
imports `GiftAccessor`).

### D2. Domain: share fields, the publish transition and the publication record

- `ShareIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/)`, exported from the domain and
  re-exported by contracts.
- `GiftSchema` gains `shareId: ShareIdSchema.optional()` and `publishedAt: z.coerce.date().optional()`.
  A `superRefine` enforces: status `published` ⇒ both present, status `draft` ⇒ both absent. Other
  statuses are unconstrained until Sprint 4–5 define them. `toDocument` omits `undefined` fields,
  so drafts keep having no `shareId` key (the unique index relies on that, D12).
- `publishGiftDraft(gift, { expectedRevision, shareId, now })` returns
  `Result<Gift, GiftDraftError | GiftTransitionError>`:
  1. `GIFT_NOT_DRAFT` unless the status is `draft`;
  2. `GIFT_REVISION_CONFLICT` unless `revision === expectedRevision`;
  3. `GIFT_NOT_OWNED` (new code) when `ownership.ownerId` is `null`;
  4. `transitionGift("draft", "publishing")`, then `transitionGift("publishing", "published")`.
     Each failure is returned as is;
  5. the result is `GiftSchema.parse({ ...gift, status: "published", shareId, publishedAt: now,
updatedAt: now })`, with `revision` unchanged.

  Only the final state is persisted (D6). `publishing` exists in the domain path so that Sprint 4
  can split the two transitions around a payment or an outbox step without changing callers.

- `GiftPublicationSchema` (strict): `id` (UUID), `giftId`, `shareId`, `revision`, `templateId`,
  `templateVersion`, `artifactContentHash` (64 lowercase hex), `content` (record), `assetIds`
  (unique UUIDs, at most 30), `audioTrackId` (string or null), `publishedAt`, `createdAt`.
  `createGiftPublication({ id, gift, artifactContentHash, assetIds, audioTrackId })` requires a
  published gift and copies `content.data`, `templateId`, `templateVersion`, `revision`, `shareId`
  and `publishedAt` from it, so the snapshot can never disagree with the gift.
- Tests in `gift-status.test.ts` and `gift-publication.test.ts`:
  - allowed: `draft → publishing`, `publishing → published`;
  - refused: `draft → published`, `published → publishing`, `publishing → publishing`,
    `deleted → publishing`;
  - `publishGiftDraft` for each error, and the success output;
  - the `GiftSchema` invariant both ways.

### D3. Internal publish entitlement

- `config/internal-publish.ts` parses `{ INTERNAL_PUBLISH_ENABLED, VERCEL_ENV }`. The result is
  `enabled = INTERNAL_PUBLISH_ENABLED === "true" && VERCEL_ENV !== "production"`. Any other value,
  including a typo, reads as `false` and never throws. The flag is read per request, so a wrong
  value must not take the site down, which is the same reasoning as `technical-spikes.ts`.
- Application port `PublishEntitlement { canPublish(ownerId: string): boolean }`.
  `composition/gifts.ts` supplies `() => getInternalPublishEnvironment().enabled`. Sprint 4
  replaces the implementation with a real entitlement lookup (ADR-0009). The owner id argument is
  unused today, but it keeps the port shape stable.
- The Studio page reads the same function to render the disabled state (D10). It never decides
  access: the API does.
- Environments: `.env.example` documents `INTERNAL_PUBLISH_ENABLED=false`. The deployment runbook
  table gets a row: `true` on the `dev` and `stg` Preview branches, and absent in Production.
  `playwright.config.ts` sets `"true"`.

_Alternative rejected:_ a compile-time entry in `FEATURE_FLAGS`. It cannot differ between `dev`,
`stg` and Production builds of the same commit.

_Alternative rejected:_ an allowlist of user ids or e-mails. Gate M2 asks for "a person outside
the team" on staging. An allowlist adds data handling without protecting anything that the
Production force-off does not already protect.

### D4. Publish route, service flow and error mapping

**Route order** (`publish-route-handler.ts`, following the claim route):

1. `validateJsonMutationRequest` → `415`/`403`;
2. `PublicGiftIdSchema` → `404`;
3. `GiftIdempotencyKeySchema` on `Idempotency-Key` → `400` with `fieldErrors.idempotencyKey`;
4. `getGiftRequestContext`, then `enforceGiftMutationRateLimit(..., "gift-publish", id)`;
5. `readJsonBody(PublishGiftRequestSchema)` → `400`;
6. `giftService.publishGift({ publicId, userId: context.userId, idempotencyKey,
expectedRevision })`;
7. success → `createApiSuccessResponse({ publication }, id, 201)`. Other results go through
   `giftServiceErrorResponse`. A thrown error logs `{ event: "gift_publish_failed", requestId }`
   only, and answers `500`.

The session check is inside the service (step 6), after the rate limit, as for claim. An
unauthenticated flood is therefore bounded by the network subject.

**Service flow** (`publishGift`):

| Step | Check                                                                                            | Result on failure                                         |
| ---- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 1    | `userId` present                                                                                 | `NOT_AUTHENTICATED` → `401`                               |
| 2    | `gifts.findAuthorized(publicId, [{ kind: "user", userId }])` — the owner filter only             | `NOT_FOUND` → `404`                                       |
| 3    | `entitlement.canPublish(userId)`                                                                 | `FORBIDDEN` (new) → `403` `FORBIDDEN`                     |
| 4    | idempotency record for `gift-publish:{key}`: same actor, fingerprint and gift → load publication | mismatch → `IDEMPOTENCY_CONFLICT` → `409`; match → replay |
| 5    | `status === "draft"`                                                                             | `INVALID_STATE` → `409`                                   |
| 6    | `revision === expectedRevision`                                                                  | `REVISION_CONFLICT` → `409` with details                  |
| 7    | `gift.access.mode === "unlisted"` (fail closed)                                                  | `ACCESS_POLICY_UNSUPPORTED` (new) → `409` + reason        |
| 8    | `templates.findEditableManifest(templateId, version)`                                            | `TEMPLATE_NOT_EDITABLE` (new) → `409` + reason            |
| 9    | `artifacts.resolve(id, version)` returns `{ contentHash }`                                       | `TEMPLATE_UNPUBLISHABLE` (new) → `409` + reason           |
| 10   | `collectContentIssues(...)` is empty (D5)                                                        | `INVALID_CONTENT` → `400` with `issuesToFieldErrors`      |
| 11   | `publishGiftDraft`, `createGiftPublication`, then `gifts.publishDraft(...)` (D6)                 | mapped from the transaction outcome                       |

- The idempotency document is written with every field the `idempotencyKeys` validator requires:
  `_id` `gift-publish:{key}`, `scope` `gift-publish`, `key`, `actorKey` `user:{userId}`, `giftId`,
  `requestFingerprint` `JSON.stringify(["publish", publicId, expectedRevision])`, `expiresAt`
  (now + 24 h), `createdAt` and `updatedAt` (both now). `GiftIdempotencyDocument.scope` in
  `mongo-gift-repository.ts` widens from `GiftCreateIdempotency["scope"]` to
  `"gift-create" | "gift-publish"`. A new `GiftPublishIdempotency` type sits next to
  `GiftCreateIdempotency`, and `findIdempotentGift` is only used for `gift-create`.
- Every `409` from the publish checks other than "already published" (step 5) carries a
  `details.reason`, so the Studio reloads only when the gift really changed state elsewhere.
- Step 4 runs before the status check, so a replay of a successful publish returns `201` although
  the gift is no longer a draft. A different key for a published gift fails at step 5 with `409`.
- The replay DTO is built from the stored publication (`shareId`, `publishedAt`, `revision`), not
  from the current gift, so replays are byte-identical.
- `gift-route-helpers.ts` gains four mappings:
  - `FORBIDDEN` → `403` with `Publishing is not enabled for this account.`;
  - `ACCESS_POLICY_UNSUPPORTED` → `409` with `details: { reason: "ACCESS_POLICY_UNSUPPORTED" }`;
  - `TEMPLATE_NOT_EDITABLE` → `409` with `details: { reason: "TEMPLATE_VERSION_NOT_EDITABLE" }`;
  - `TEMPLATE_UNPUBLISHABLE` → `409` with `details: { reason: "TEMPLATE_VERSION_UNPUBLISHABLE" }`
    and `This template version cannot be published.`

  The existing `INVALID_STATE` mapping (no details) stays for draft saves and preview links.

- `GiftPublicationDto` is `{ publicId, status: "published", shareId, sharePath, publishedAt,
revision }`. `sharePath` is `/g/{shareId}`. Absolute URLs are built by the browser from its own
  origin (D10), so the API needs no `APP_URL`.
- `GiftMutationScope` and `consumeGiftMutationRateLimit` are renamed `ApiRateLimitScope` and
  `consumeApiRateLimit`, because public reads are not mutations. `ApiRateLimitScope` gains
  `gift-publish` with 10 requests per 600 s. One user publishes a
  handful of gifts at most, and 10 still allows retries.

_Alternative rejected:_ answering `400` for a version without an artifact, as the brief's list
of checks suggests. The creator cannot fix that by editing fields, and `409` `CONFLICT` is what a
non-editable version already gives for saves and preview links. The Studio shows a dedicated
message (`studio-editor`).

_Alternative rejected:_ treating a publish with a new key for an already published gift as a
replay. It would let any second tab "succeed" without a stored key. With `409`, the Studio reloads
and shows the published panel, which is the same user outcome.

### D5. One content check for preview and publish

`add-gift-preview` computes `issues` inside `buildViewerPayload`, after signing. Publish needs
the same issues without signing any URL. This change extracts the pure part into
`modules/viewer/application/content-issues.ts`:

```ts
collectContentIssues(
  { manifest, content, giftId, assets /* MediaAsset[] of the gift */ },
  { findSelectableTrack },
): ViewerIssue[]
```

- An asset counts as available when it is in the gift's list, `asset.fieldId === fieldId` and
  `status === "ready"`. That is exactly the rule for an `assets` entry (`viewer-payload` "Asset URL
  selection"). `buildViewerPayload` then calls `collectContentIssues` instead of its inline code,
  so its output is unchanged and its existing tests keep passing unmodified.
- `collectContentIssues` fails closed: when the full payload rules fail but no failure names a
  declared field (an undeclared key, for example), it reports `CONTENT_INVALID` on the first
  field, so a publish can never proceed on invalid content (`viewer-payload` "Content issues":
  any other failure is `CONTENT_INVALID`).
- When the transaction answers `assets-changed` but a fresh listing shows no issue any more, the
  field errors name only the image fields whose referenced assets changed between the check and
  the transaction (all referenced image fields only when no difference is visible).
- `issuesToFieldErrors(issues, fields)` builds keys `fieldId`, or `fieldId.itemIndex` for item
  issues, with English messages chosen by code:
  - `This field is required.`;
  - `Add at least {minItems} images.`;
  - `This value is not valid.`;
  - `This image is not ready.`

  No gift text is included.

- A publish of revision N is accepted exactly when the preview of revision N lists no server
  issue. Template `ISSUE`s, such as a photo failing to load in the browser, are runtime only and
  are not checked by publish.

_Alternative rejected:_ calling `buildViewerPayload` and ignoring the URLs. It would sign up to 30
URLs per publish attempt for nothing.

_Alternative rejected:_ re-validating with `parseTemplatePayload` plus `validateMediaReferences`,
as `updateDraft` does. That accepts `processing` or `failed` assets and produces different field
errors from the preview panel, which is the drift Gate M2 forbids.

### D6. The publish transaction

`GiftRepository.publishDraft({ gift, publication, idempotency, expectedRevision, ownerId,
assetRefs })` returns one of `published`, `replayed`, `idempotency-conflict`, `stale` or
`assets-changed`. It runs inside `client.withSession(... session.withTransaction(...))`:

1. Read `idempotencyKeys` `{ scope: "gift-publish", key }` in the session. If a record exists,
   return `replayed` (with its publication) or `idempotency-conflict` without writing. This
   covers the concurrent double click. The loser's insert in step 5 would otherwise raise a
   duplicate key error.
2. `gifts.findOneAndUpdate({ _id, "ownership.ownerId": ownerId, status: "draft",
"access.mode": "unlisted", revision: expectedRevision }, { $set: { status: "published", shareId,
publishedAt, updatedAt } })`. `null` → abort, return `stale`.
3. `assets.updateMany({ giftId, status: "ready", $or: assetRefs.map(({ fieldId, assetIds }) =>
({ fieldId, _id: { $in: assetIds } })) }, { $currentDate: { updatedAt: true } })`.
   `matchedCount !== total` → abort, return `assets-changed`. Skipped when there are no assets.
   The update must be a real write: MongoDB skips a write, and detects no conflict, when an update
   leaves the document byte-identical, for example a `$set` of a value it already holds.
   `$currentDate` stores the server's current time, which differs from the stored `updatedAt`
   written earlier. The test asserts `$currentDate`, not `$set`.
4. `giftPublications.insertOne(publication)`.
5. `idempotencyKeys.insertOne({ _id: "gift-publish:{key}", ... })`.

Aborting means throwing a private sentinel inside the callback. The driver aborts the transaction,
and the repository catches the sentinel and returns the outcome. A `MongoServerError` 11000 outside
the sentinel (a concurrent request with the same key committed first) re-reads the record outside
the transaction, like `createDraft`. A duplicate `shareId` (probability about 2⁻¹²⁸ per pair) is
not retried and surfaces as a `500`.

The service maps the outcomes:

- `stale` → re-read with the owner filter: `NOT_FOUND`, `INVALID_STATE`,
  `ACCESS_POLICY_UNSUPPORTED` or `REVISION_CONFLICT` with the current revision;
- `assets-changed` → `INVALID_CONTENT`, after recomputing the issues from a fresh asset list;
- `idempotency-conflict` → `IDEMPOTENCY_CONFLICT`;
- `replayed` → the stored publication.

**Why step 3 writes to the assets.** MongoDB transactions use snapshot isolation and detect only
write-write conflicts. A delete that checks "gift is draft" and then updates the asset could
otherwise interleave with a publish that checks "asset is ready" and then updates the gift (write
skew). Step 3 makes publish write every referenced asset. The delete's transaction (D7) writes the
same asset. One of the two therefore aborts with a `WriteConflict`, and the driver's
`withTransaction` retries it. On retry it sees the other's committed state and refuses. The
delete's write (`status` → `deleting`) always changes the document, and publish's `$currentDate`
does too, so both are real writes. Touching `updatedAt` is harmless, because asset DTOs do not
expose it.

_Alternative rejected:_ a `publicationId` or lock field on asset documents. `MediaAssetSchema` is
strict, so every asset read path would change, for the same guarantee.

_Alternative rejected:_ persisting `publishing` first and `published` in a second step. With no
asynchronous work there is nothing to wait for. The intermediate state would need crash recovery
that Sprint 4 designs with the outbox.

### D7. Media: draft-only operations and an atomic delete

- `findAuthorizedAsset` and `listAssets` require `gift.status === "draft"` and return
  `NOT_FOUND` otherwise. That covers `getAsset`, `listAssets`, `completeUpload`, `deleteAsset`
  and `retryAsset`, with the same `404` for every cause (`media-upload` "Gift-bound asset
  authorization"). `initializeUpload` already does this.
- `MediaAssetRepository.markDeleting(assetId, giftId, now)` runs in a transaction and returns
  `{ kind: "deleting", asset }`, `{ kind: "gift-not-draft" }` or `{ kind: "asset-unavailable" }`:
  1. `gifts.findOne({ _id: giftId, status: "draft" }, { session, projection: { _id: 1 } })`. If
     there is none, the result is `gift-not-draft`;
  2. the existing asset `findOneAndUpdate` to `deleting`, in the session. `null` gives
     `asset-unavailable`.

  The service maps `gift-not-draft` to `NOT_FOUND` (`404`), and `asset-unavailable` to
  `INVALID_STATE` (`409`) as before. **Behavior change:** a delete of an asset of a non-draft
  gift used to proceed (and a lost transition answered `409`). It now answers `404` in both the
  pre-check and the in-transaction case. The existing `media-service.test.ts` and
  `media-route-handlers.test.ts` expectations are updated accordingly (task 6.2).

  Together with D6 step 3, this closes the race (`media-upload` "Deletion races a publish").

- `requeue` needs no transaction change. A retried asset is `failed`, so it is never referenced by
  a publication (publish requires `ready`), and the status pre-check is enough.
- `db:verify-media` does not call `markDeleting` and stays unchanged. `db:verify-gifts` inserts one
  `ready` asset for its verification gift, publishes with it, and asserts that
  `markDeleting(assetId, giftId, now)` then returns `{ kind: "gift-not-draft" }`, with the asset
  still `ready`, on a real replica set. It also runs two concurrent `publishDraft` calls with one
  key (one publication, one share id for both) and, on a second draft, a `publishDraft` racing
  `markDeleting` of its only asset (exactly one wins). Its `explain` uses
  `connectDiagnosticMongoClient` from `packages/database`, because `explain` is outside the
  strict Stable API of the application client
  (`database-schema-management` "Gift persistence verification").

### D8. Public read service and endpoint

- **Repositories.**
  - `GiftRepository.findPublishedByShareId(shareId)` filters on
    `{ shareId: { $eq: shareId, $type: "string" }, status: "published", "access.mode": "unlisted" }`.
    The `$type: "string"` term matches the partial filter of `gifts_share_id_unique`, so the
    planner can use that index. Without it, a partial index is not eligible for an equality on a
    field that could be missing. `$eq` also stops an object value from being read as an operator,
    although `ShareIdSchema` already rejects it. `db:verify-gifts` asserts that `explain()` of
    this query shows an `IXSCAN` on `gifts_share_id_unique`;
  - `GiftPublicationRepository.findByShareId(shareId)` filters on
    `{ shareId: { $eq: shareId } }` (unique index `gift_publications_share_id_unique`) and checks
    `giftId` against the gift;
  - replays read the publication by `giftId` inside the publish repository (`findPublishReplay`),
    in the transaction's session when there is one, so the port needs no `findByGiftId`.
- **`PublicGiftService`**, where both entry points share one private `resolveLiveShare(shareId)`:
  1. the format check;
  2. the gift (`findPublishedByShareId`);
  3. the publication (`findByShareId`, same `giftId`);
  4. `findEditableManifest(publication.templateId, publication.templateVersion)`.

  Any `null` gives `null`. On top of that:
  - `isLiveShare(shareId)` returns `resolveLiveShare(...) !== null`. It is used by the page. That
    costs three indexed single-document reads, and page and endpoint can never disagree on
    not-found (`public-gift-viewer` "Share link access");
  - `openPublicGift(shareId)` continues with `assets.listByGiftId(gift.id)`, then
    `buildViewerPayload({ manifest, content: publication.content, giftId, assets,
expectedContentHash: publication.artifactContentHash }, viewerPorts)`, and drops `issues`.

- **Route order** (`public-gift-route-handler.ts`):
  1. `requestId`;
  2. `ShareIdSchema` → `404`;
  3. the rate limit, with `subject = publicReadSubject(request)` (below):
     - `consumeApiRateLimit("public-gift-read", subject + "|share:" + shareId, secret)`;
     - then, if allowed, `consumeApiRateLimit("public-gift-read-ip", subject, secret)`.

     The first refusal answers `429` with `Retry-After` as usual. Subjects are HMAC-hashed, so
     neither the address nor the share id is stored;

  4. `openPublicGift` → `404` `Gift was not found.` on `null`;
  5. `createApiSuccessResponse({ viewer }, id)`.

  A thrown error logs `{ event: "public_gift_read_failed", requestId }` and answers `500`. The
  envelope already sets `Cache-Control: no-store`.

- **Subject.** `publicReadSubject(request)` reads the first `x-vercel-forwarded-for` value:
  - an IPv4 address gives `ip:<address>`;
  - an IPv6 address gives `ip6:<first 4 hextets>::/64`, after expanding `::` and normalizing
    case. Clients usually hold a whole `/64`, and privacy extensions rotate the low bits;
  - anything else gives `unidentified`.

  It never looks at the session or the cookie. The existing `giftRateLimitSubjects` is unchanged.

- **Limits.** `public-gift-read` (per network subject and share id) allows 60 per 600 s.
  `public-gift-read-ip` (per network subject) allows 600 per 600 s. `unidentified` gets ×5 on
  both (300 and 3000), through the shared-bucket rule, which now also recognizes a qualified
  subject (`unidentified|share:...`) as the shared `unidentified` bucket. One open costs one call, and a
  fallback URL refresh costs one more. Vietnamese mobile carriers put many subscribers behind one
  CGNAT IPv4 address. A plain per-IP limit of 60 would let a few recipients exhaust it for
  everyone else on that address, while the per-link counter only throttles repeated reads of one
  gift. The per-network cap of 600 still bounds scanning, which 128-bit share ids make pointless
  anyway.
- **Unthrottled page render (accepted).** `GET /g/{shareId}` costs at most three indexed reads
  when the format is valid, and nothing otherwise, like `/preview/{token}` and any 404 page. A share id has
  128 bits of entropy, so enumeration is infeasible.

### D9. `/g/{shareId}` page

- `app/g/layout.tsx`: `await connection()` (ADR-0005). This is new, because `/g` had a CSP mapping
  but no route.
- `app/g/[shareId]/page.tsx`:
  - `dynamic = "force-dynamic"`;
  - static `metadata` with the title `Một món quà dành cho bạn` (the root template adds
    ` · LoveMemory`), `description`, `openGraph { title, description }` without images, and
    `robots { index: false, follow: false }`;
  - it awaits `isLiveShare(shareId)` and calls `notFound()` on `false`;
  - it renders `<PublicGiftScreen shareId={shareId} />`.

  No gift data crosses into the client props.

- `app/g/[shareId]/not-found.tsx` renders `Món quà không tồn tại hoặc đã được thu hồi.` and a
  home link. Because of the root `loading.tsx`, the status is `200` with a `noindex` meta tag and
  the header below, identical for every cause (as in `add-gift-preview` D4).
- `PublicGiftScreen` (client) keeps `muted` state and mounts `GiftViewer` with
  `source = { kind: "deferred", load: () => loadPublicGift(fetch, shareId) }`. `loadPublicGift`:
  - calls `fetch("/api/public-gifts/{shareId}", { cache: "no-store", credentials: "omit" })`;
  - requires `200` and a body that parses with `PublicGiftResponseSchema`, and throws otherwise;
  - returns `data.viewer` as a `ViewerPayload`.

  It passes no `onIssuesChange` and no reporting `onLifecycleEvent`. `add-funnel-analytics` adds
  that.

- `next.config.ts`, all additive:
  - a `headers()` entry for `/g/:path*` after the global entry: `Referrer-Policy: no-referrer`,
    `X-Robots-Tag: noindex`, `Cache-Control: private, no-store`;
  - `logging.incomingRequests.ignore` gains `/^\/g\//` and `/^\/api\/public-gifts\//`.

  `no-referrer` keeps the share URL out of `Referer` for signed image requests and outbound
  navigation.

### D10. Studio: publish step, published panel and the owner status read

- `giftService.getStudioGift({ publicId, accessors })` uses `findAuthorized` (all accessors, like
  `getDraft`) and returns:
  - `{ kind: "draft", draft }`;
  - `{ kind: "published", publication: GiftPublicationDto }`, built from `gift.shareId`,
    `gift.publishedAt` and `gift.revision`;
  - `NOT_FOUND` for other statuses and for no access.

  `app/studio/[publicId]/page.tsx` switches on it. For `published` it renders `PublishedPanel`
  and loads no manifest, no audio and no editor. `getDraft` and `GET /api/gifts/{publicId}` are
  unchanged (`gift-drafts` "Read a draft").

- `updateDraft` answers `NOT_FOUND` (`404`) for an authorized gift that is no longer a `draft`,
  both in its first read and in the re-read after a lost conditional write. It used to answer
  `INVALID_STATE` (`409`), which contradicted `gift-publishing` "Publishing ends draft access"
  ("Save after publish"). The Studio already treats a `404` save as the non-editable alert.

- The page passes `publishEnabled = getInternalPublishEnvironment().enabled`, `signedIn` and
  `ownerKind` to the Studio. `publish-step.tsx` renders the disabled reasons in the order the
  spec gives. For anonymous drafts, it reuses `ClaimDraftButton` (which calls `router.refresh()`
  on success) or the sign-in link.
- `publish-action.ts` `requestPublish({ flush, fetch, publicId, idempotencyKey })`:
  1. `await flush()`. Anything but `saved` → `{ kind: "blocked" }`;
  2. `POST` with `Content-Type: application/json`, `Idempotency-Key` and
     `{ expectedRevision: flushed.revision }`;
  3. it classifies the response into `published` (with a valid `GiftPublicationResponseSchema`),
     `invalid` (fieldErrors), `unauthenticated`, `forbidden`, `gone`, `conflict`
     (actualRevision), `unpublishable` (reason `TEMPLATE_VERSION_UNPUBLISHABLE` or
     `TEMPLATE_VERSION_NOT_EDITABLE`), `access-unsupported`, `reload` (a `409` without `details`
     only), `rate-limited` (retryAfterSeconds) or `failed`.

  The step component maps each outcome to the spec's message or store action:
  - `invalid` → `store.applyServerFieldErrors`;
  - `conflict` → the store's conflict path;
  - `gone` → `readOnly`;
  - `reload` → `window.location.reload()`;
  - `published` → `controller.dispose()`, a local state switch to `PublishedPanel`, then
    `router.refresh()`, so the server page renders the published gift without the draft
    ownership aside and its claim action.

- The idempotency key is `crypto.randomUUID()` in a `useRef`, created once per mounted Studio.
  Because keys are recorded only on success (D6), reusing it after a `400` with a new revision is
  valid.
- `PublishedPanel` (client) builds `new URL(sharePath, window.location.origin)` in an effect. The
  server render shows `sharePath`, which avoids a hydration mismatch. `Sao chép liên kết` uses
  `navigator.clipboard.writeText`, and on rejection or absence shows the manual-copy message.
  `Mở món quà` is a plain link with `target="_blank"` and `rel="noopener noreferrer"`.

### D11. Contracts

- `packages/contracts/src/gift.ts`:
  - `PublishGiftRequestSchema = z.object({ expectedRevision: z.number().int().nonnegative() }).strict()`;
  - `GiftPublicationDtoSchema` (strict, with `sharePath` matching `^/g/[A-Za-z0-9_-]{22}$`);
  - `GiftPublicationResponseSchema`;
  - the re-exported `ShareIdSchema`.
- `packages/contracts/src/viewer.ts`: `ViewerPayloadDtoSchema` (strict):
  - `artifactUrl` (a `/template-artifacts/…/index.html` path, or null);
  - `payload` (record);
  - `assets` (record of URL strings);
  - `assetsExpireAt` (ISO datetime, or null);
  - `audioUrl` (an `/audio-library/` path, or null);
  - `fields` (array of `{ id, label, type, required, minItems?, maxItems? }`).

  No `issues`, because strict mode rejects it. `PublicGiftResponseSchema = { data: { viewer } }`.
  It must match `ViewerPayload` minus `issues`. A type-level test (`satisfies`) keeps them aligned,
  as `add-gift-preview` D2 anticipated.

### D12. Database schema version 8

- `COLLECTIONS.giftPublications = "giftPublications"`.
- `gifts` validator: `shareId` `{ bsonType: "string", pattern: "^[A-Za-z0-9_-]{22}$" }` and
  `publishedAt` `{ bsonType: "date" }`, both optional. The new index `gifts_share_id_unique` is on
  `{ shareId: 1 }`, unique, with `partialFilterExpression: { shareId: { $type: "string" } }`. This
  follows the `assets_source_key_unique` precedent rather than `sparse`, because drift detection
  already compares partial filters.
- `giftPublications` validator as in the spec, with `additionalProperties: true`. Indexes:
  - `gift_publications_share_id_unique` on `{ shareId: 1 }`, unique;
  - `gift_publications_gift_revision_unique` on `{ giftId: 1, revision: 1 }`, unique. It also
    serves the replay read by `giftId`.
- `apiRateLimits` `scope.enum` gains `gift-publish`, `public-gift-read` and `public-gift-read-ip`.
- `DATABASE_SCHEMA_VERSION = 8`.
- `migrations.test.ts` asserts the definitions, and that drift in the new validator and indexes
  is detected. It also simulates a version-`6` database (no `previewTokens`, the version-6
  `apiRateLimits` enum, no `giftPublications`) and asserts that one migration run reaches
  version `8`, because an environment such as `stg` may skip the version-7 deployment. Task 3.2
  repeats that on a real replica set.
- The registry spec lists names alphabetically. In code the collection is appended.

### D13. MODIFIED requirement provenance (re-diff before apply)

| Capability                   | Requirement                                                                                                       | Based on                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `studio-editor`              | Studio preview and publish steps                                                                                  | `add-gift-preview` delta (which MODIFIES the `add-schema-driven-studio` ADDED text)                            |
| `gift-draft-ownership`       | Draft authorization                                                                                               | `add-gift-preview` delta                                                                                       |
| `mutation-request-guards`    | Distributed mutation rate limits                                                                                  | `add-gift-preview` delta                                                                                       |
| `content-security-policy`    | Nonce routes are dynamically rendered                                                                             | `add-gift-preview` delta                                                                                       |
| `database-schema-management` | Collection registry; JSON-schema validators; Named indexes; Idempotent migration with ledger; Schema verification | `add-gift-preview` delta                                                                                       |
| `database-schema-management` | Gift persistence verification                                                                                     | `openspec/specs/` at proposal time (no earlier Sprint 3 change touches it)                                     |
| `gift-drafts`                | Read a draft                                                                                                      | `openspec/specs/` at proposal time (`add-schema-driven-studio` modifies other `gift-drafts` requirements only) |
| `media-upload`               | Gift-bound asset authorization; Asset deletion                                                                    | `openspec/specs/` at proposal time                                                                             |

Task 1.1 re-diffs each block against `openspec/specs/` once `add-gift-preview` is archived.

- **Expected differences.** None, apart from this change's edits. If `add-gift-preview` changes
  a block during its own apply, merge that change first.
- **Expected gate warnings until then.** `check-openspec.ts` warns that `studio-editor` "Studio
  preview and publish steps" does not exist in `openspec/specs/`. `openspec validate` reports an
  INFO that archive would refuse the `studio-editor` delta. Both clear once
  `add-schema-driven-studio` and `add-gift-preview` are archived.
- **Waivers** (owner `DevViTien`). The coordinator records them in
  `openspec/gate-exceptions.json`, and task 11.3 removes them at archive:
  1. `database-schema-management` / "Schema verification" is needed **now**. The block replaces
     the backticked `MongoDB schema version mismatch: expected 6, received 1.` (today's main spec)
     and, after `add-gift-preview` is archived, `… expected 7, received 1.`, with the version-8
     message. One entry covers both periods.
  2. `studio-editor` / "Studio preview and publish steps" is needed **once
     `add-gift-preview` is archived**. The block intentionally drops `Sắp ra mắt`, because the
     button is no longer "coming soon". It cannot be recorded earlier: the gate would report a
     waiver that matches nothing.

### D14. Notes for `add-funnel-analytics`

- `publish_clicked` belongs in `publish-step.tsx` before `requestPublish`. `gift_published` should
  be sent from the Studio on the `published` outcome, never from replays of the server response
  alone.
- On `/g`, `PublicGiftScreen` is the place to pass `onLifecycleEvent`. The page can hand
  `templateId`/`templateVersion` to the client from `resolveLiveShare`'s publication if the events
  need them. They are not gift content. `/g` sends `Referrer-Policy: no-referrer`, so the same
  `Origin` caveat as `/preview` applies (`add-gift-preview` D10).
- `add-funnel-analytics` extends `apps/web/e2e/publish.spec.ts` (the full Gate M2 journey,
  visual snapshots, edge cases and the performance baseline) rather than writing a second
  create-to-open journey. Keep its steps and helpers reusable: the sign-in helper and the
  published-gift setup live in `apps/web/e2e/support/`.

### D15. Tests

- **Unit** (Vitest, next to the code):
  - domain: `gift-status.test.ts` and `gift-publication.test.ts` (D2), `gift-schema.test.ts` for
    the invariant, `gift-identity.test.ts` for `ShareIdSchema`;
  - contracts: `gift.test.ts` and `viewer.test.ts`;
  - `internal-publish.test.ts`: `true`, `false`, absent, `TRUE`, `1`, production;
  - `content-issues.test.ts`, plus the unchanged `build-viewer-payload.test.ts`;
  - `gift-service.test.ts`: every row of D4, replay and conflict, every transaction outcome, and
    `getStudioGift`;
  - `mongo-gift-repository.test.ts`: the `publishDraft` filters, the abort outcomes, the
    duplicate-key replay, and that `toDocument` omits `undefined`;
  - `mongo-gift-publication-repository.test.ts`;
  - `publish-route-handler.test.ts`: `201`/`400`/`401`/`403`/`404`/`409`/`415`/`429`/`500`, and the
    log line;
  - `media-service.test.ts` and `mongo-media-repository.test.ts`: non-draft `404`s and the
    transactional `markDeleting`;
  - `public-gift-service.test.ts`, `public-gift-route-handler.test.ts` and
    `load-public-gift.test.ts`;
  - `mongo-gift-rate-limiter.test.ts` for `gift-publish`, `public-gift-read`,
    `public-gift-read-ip` and the IPv6 `/64` subject;
  - `publish-action.test.ts`;
  - `migrations.test.ts` and `collections.test.ts`;
  - `content-security-policy.test.ts` (`/g/` already nonce, regression only);
  - the next.config test from `add-gift-preview`, extended.
- **Component** (`.tsx`, not coverage-gated, no jest-dom matchers): `publish-step.test.tsx`,
  `published-panel.test.tsx` and `public-gift-screen.test.tsx` (no content and no fetch before
  the tap).
- **Real MongoDB:** `db:verify-gifts` (the spec'd publish checks, including the refused asset
  deletion) and the unchanged `db:verify-media`.
- **E2E** (`apps/web/e2e/publish.spec.ts`, production build, local object storage, run by the
  coordinator): see task 10.1.

## Risks / Trade-offs

- **[Risk] A share link is a bearer secret with no revocation in this change.** → It carries 128
  bits of entropy, and it is kept out of logs and `Referer`. The page and the payload are
  `no-store` and `noindex`, and the Studio notes who can open it. Pause, revoke and password
  access come in Sprint 4–5 (Out of scope).
- **[Risk] Hosting platform request logs retain `/g/{shareId}`.** Vercel records the request path
  of every function and edge request, so the share id, a bearer secret, lands in platform logs.
  The application cannot remove it from there, and a link cannot be revoked until Sprint 4.
  → Mitigations and documentation:
  - who can read the logs: only members of the Vercel team with access to the project. The
    runbook lists the roles, and access is reviewed with the Production secret owners;
  - retention: the Vercel plan's runtime-log retention applies, and no log drain is configured.
    The runbook states that retention depends on the plan and any log drain (checked in the
    dashboard, no number asserted) and states that adding a log drain must
    first strip `/g/` and `/api/public-gifts/` paths;
  - exposure: only `dev` and `stg` can publish in Sprint 3 (Production is forced off), so only
    test gifts are exposed;
  - follow-up: revocation and re-issue of share ids (plan.md §13.1–13.2, Sprint 4) is the real
    fix. `docs/architecture.md` and `docs/runbooks/preview-deploy-and-rollback.md` both link to
    it (tasks 4.1 and 7.3).
- **[Risk] `INTERNAL_PUBLISH_ENABLED=true` accidentally set in Production.** → It is forced off
  when `VERCEL_ENV` is `production`, and a unit test covers that. Production stays unable to
  publish until Sprint 4 brings entitlements.
- **[Risk] Write-skew between delete and publish.** → Both transactions write the asset documents
  (D6, D7). Unit tests assert that both writes exist, and `db:verify-gifts` exercises publish plus
  the refused `markDeleting` on a real replica set. A true interleaving test is not practical, so
  the reasoning is documented in `docs/architecture.md`.
- **[Risk] A template artifact changes after publish.** → The public payload pins
  `artifactContentHash`, and a mismatch shows the static rendering with all content. Committed
  releases (`add-memory-box-template`) make this a defense in depth only.
- **[Trade-off] The not-found page streams with status `200`.** → The same as `/studio` and
  `/preview`. It is `noindex` (meta and header) and identical for every cause. The API answers a
  real `404`.
- **[Trade-off] Published gifts cannot be edited.** → This is the intended Sprint 3 behavior. The
  Studio says so before publishing. Re-publishing edits is Sprint 4 (plan.md §13.1).
- **[Risk] Merge order.** This change edits files the earlier changes also touch:
  - `next.config.ts`, `readiness-step.tsx`, `draft-editor.tsx` and the Studio store;
  - `build-viewer-payload.ts` (extraction only) and `composition/media.ts`;
  - `migrations.ts` (version `7` → `8`).

  → The edits are additive. Apply starts only after all four earlier changes are merged (task
  1.1).

## Migration Plan

1. Deploy runs `pnpm db:migrate`. From version `7`, and equally from version `6` when an
   environment skipped the `add-gift-preview` deployment, it creates `previewTokens` if missing,
   creates `giftPublications`, replaces the `gifts` and
   `apiRateLimits` validators, adds `gifts_share_id_unique` (no existing document has a
   `shareId`, so the build cannot fail) and records version `8`.
2. Ship the code in the same deployment. Set `INTERNAL_PUBLISH_ENABLED=true` on the `dev` and
   `stg` Preview branches only.
3. **Rollback:** redeploy the previous build.
   - **Production:** no gift can be published there (the flag is forced off), so no document has
     `shareId` or `publishedAt`, and the rollback is clean.
   - **`dev` and `stg`:** the previous build's strict `GiftSchema` throws when it parses a
     published gift document, because of the unknown `shareId` and `publishedAt` keys.
     `/studio/{publicId}` of a published gift and every media route for it then answer `500`, not
     not-found. Reads of other gifts are unaffected, because each query returns only its own
     document, and `/g` simply does not exist. Safe options, in order of preference:
     1. roll forward with a fix instead of rolling back;
     2. roll back and accept `500`s for the few test gifts until the roll-forward;
     3. if a clean rollback is required, first set `INTERNAL_PUBLISH_ENABLED=false`, then move
        the published test gifts out of the way with a one-off script (for example `$unset`
        `shareId`/`publishedAt` and set `status: "draft"`, keeping `giftPublications` for a later
        restore). It is written and reviewed at that time, never run ad hoc.
        Their data otherwise stays intact.
   - The old `db:verify` reports drift. Running the old `db:migrate` restores the version-7
     validators, index set and ledger. `gifts_share_id_unique` is not in the version-7 set, but
     the migration drops only legacy indexes it knows, so the extra index stays harmless.
   - Validators apply only to writes, so existing published documents remain.
   - Re-deploying this change later restores access without data repair.

   `docs/architecture.md` records this note.
