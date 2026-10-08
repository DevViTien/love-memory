# Architecture

## Shape

LoveMemory starts as a modular monolith with separately versioned template artifacts.

```text
Browser
├── Marketing and catalog
├── Studio
└── Viewer shell
    └── Sandboxed template runtime

Next.js web/BFF
├── Feature modules
├── Application services
└── Data access layer

Managed infrastructure
├── MongoDB Atlas for operational documents
├── Private Vercel Blob for user media and derivatives
└── Background jobs for processing and reliable side effects
```

## Dependency direction

```text
presentation → application → domain
                         ↘ ports ← infrastructure
```

- Domain packages have no framework/provider dependency.
- Application services coordinate behavior through ports.
- Infrastructure implements ports with MongoDB, storage, email or payment providers.
- Presentation maps HTTP/UI concerns to application inputs and outputs.

## Package ownership

### shared

Only concepts shared by most packages belong here: app identity, HTTP-neutral result primitives and small safe utilities. Feature-specific constants stay with their feature.

### contracts

External API request/response schemas. Contracts are validated at runtime and imported by both server and clients.

### domain

Business state and invariants such as gift transitions. It cannot import React, Next.js, MongoDB or provider SDKs.

### template-sdk

The stable boundary between Studio, Viewer and template artifacts. A published artifact is immutable.

### database

MongoDB connection and collection naming. Repositories belong to feature infrastructure, not this generic package.

### ui

Accessible, reusable primitives. Product-specific composition stays in app feature modules.

## Boundary rules

1. Validate untrusted data at entry.
2. Authorize close to data access.
3. Return DTOs, never raw database documents.
4. Store binary objects outside MongoDB.
5. Put long-running/retryable work in background jobs.
6. Keep protected gift payloads out of public caches.
7. Keep template dependencies out of the Viewer shell.
8. Make publish and payment workflows idempotent.

These rules are enforced by type-aware ESLint import restrictions, per-runtime TypeScript configs,
runtime schemas and tests. Composition roots under `apps/*/src/composition` are the only place where
application services are wired to concrete infrastructure adapters.

## Rendering and CSP

Public catalog routes use a static-compatible CSP. They currently render per request
(`force-dynamic`) because they read the persisted template registry, but they must never depend on a
nonce, so they can return to static or cached rendering later. Studio, Viewer and preview routes receive a
per-request nonce, and each of those route trees calls `connection()` in its layout. A route must
never use nonce CSP unless its layout explicitly opts into dynamic rendering. Production Playwright
tests verify both modes.

## Studio editor

The Studio at `/studio/{publicId}` edits a draft through the existing `PATCH` and `GET
/api/gifts/{publicId}` routes; it adds no route and no server state. Its logic lives in
framework-free modules under `apps/web/src/modules/gifts/presentation/studio/`, so it is covered
by unit tests with fake timers; the `.tsx` components only render store state and call the
controller. Behavior is specified in `openspec/specs/studio-editor` and `studio-autosave`.

- **One store per editor.** `DraftEditor` creates a Zustand vanilla store and an autosave
  controller once per mount. The store holds the on-screen content, the last saved content and
  revision, the save status, server field errors and a conflict. Validation, step completion and
  the status message are memoized selectors over the SDK draft and full payload schemas. The
  store is never a module singleton and never persisted, so gift text does not reach browser
  storage.
- **Autosave state machine.** A change restarts a 1500 ms debounce. At most one request is in
  flight; a save that becomes due meanwhile is queued and then sends the latest content with the
  new revision. Unchanged content and content with a client-side error are never sent. A
  network error while online, a `5xx` or a `429` is retried after 2, 4 and 8 s (never before the
  `429`'s `retryAfterSeconds`); an offline failure waits for the `online` event; a `400`, a `404`
  or another `4xx` is not retried. `flush()` settles pending saves before a dependent action
  (preview, publish) and on `visibilitychange` and unmount, with `keepalive` for small bodies.
  Every Studio request goes through `fetchWithTimeout` (`apps/web/src/http/`): a save, reload or
  preview link request is aborted after 15 s and a publish after 30 s, so a stalled connection
  ends in the failed state with retries instead of `Đang lưu…` forever. An upload transfer is
  aborted after 30 s without progress, and its asset is deleted so the creator picks it again.
- **Read-only states.** While a publish request runs, and once a `404` made the draft
  non-editable, the store ignores `setFieldValue` and every input is disabled, so what the creator
  sees is what is published, and no edit is lost by the autosave being disposed on success.
- **Revision retention.** Every save still writes one `giftRevisions` snapshot, and the same
  transaction deletes the gift's snapshots older than the 20 most recent (filter served by
  `gift_revisions_identity_unique`). Snapshots hold private gift text and nothing reads them; the
  published content lives in the immutable `giftPublications` record.
- **Conflicts are explicit.** A `409` with `details.actualRevision` stops autosave. The creator
  chooses `Tải bản mới nhất` (read the stored draft and replace everything, image fields remount)
  or `Giữ bản của tôi` (save the on-screen content against the actual revision). Nothing is
  merged or retried automatically.
- **Steps and URL.** Steps come from the manifest (`resolveTemplateSteps`) plus the Studio's
  `preview` and `publish` steps. Step changes use `window.history.pushState`, which Next.js syncs
  with `useSearchParams` without a server round trip, so a step click neither re-renders the
  dynamic page nor re-reads the draft, and Back works. Inactive steps are hidden, not unmounted,
  so image uploads keep running. A `?field=` deep link opens the field's step, focuses the field
  and is replaced by `?step=`.

## Preview and gift viewer

A creator previews a draft at `/preview/{token}` before publishing. Behavior is specified in
`openspec/specs/viewer-payload`, `gift-viewer` and `gift-preview`.

- **One transformation.** `buildViewerPayload` (`apps/web/src/modules/viewer/application/`) turns
  the bound manifest, the stored content, the gift's asset records and the licensed audio catalog
  into `{ artifactUrl, payload, assets, assetsExpireAt, audioUrl, fields, issues }`. The payload is
  the stored content unchanged; `assets` maps only `ready` assets of this gift and field to a
  300-second signed URL of the derivative closest to 768 px; `artifactUrl` is the exact pinned
  version's content-addressed entry or `null` ([ADR-0004](./adr/0004-template-artifact-isolation.md)).
  The published Viewer must call the same function (with the publication's `artifactContentHash`)
  and mount the same `GiftViewer`, so "preview == published" holds by construction. `issues` is
  creator feedback that a recipient response drops.
- **Preview tokens.** `POST /api/gifts/{publicId}/preview` (owner-authorized, mutation guards,
  scope `gift-preview`: 30 per 600 s) returns `/preview/{token}`. The token is 32 random bytes in
  base64url, a read-only bearer capability for one draft. Only its SHA-256 hash is stored, in
  `previewTokens` with a TTL index; expiry (30 minutes) is enforced in the lookup filter, and the
  gift is read only while its content is editable (`draft`, or the working copy of a `published`
  gift). Links cannot be revoked before they expire; any other status ends them. Tokens are not
  deleted then, so if a gift returns to an editable status, its unexpired links become valid again.
  The token never unlocks the draft API, media or the Studio.
- **Private route.** `/preview/` is a nonce CSP route whose layout calls `connection()`
  ([ADR-0005](./adr/0005-route-specific-csp.md)). `next.config.ts` adds `Referrer-Policy:
no-referrer`, `X-Robots-Tag: noindex` and `Cache-Control: private, no-store`, and the development
  request log ignores `/preview/`. Metadata is static (`Xem trước quà · LoveMemory`).
- **Not-found status.** The home page and its loading UI live in the route group `app/(home)/`, so
  `/g` and `/preview` are not wrapped in a root Suspense boundary: the token or share-link check
  runs before the response streams, and `notFound()` answers a real `404` with a `noindex` meta tag
  and the `X-Robots-Tag` header. The response is identical for every failure cause (malformed,
  unknown or expired token, gift not a draft), so it stays opaque. `/studio/{publicId}` keeps its
  own `loading.tsx` skeleton, so its not-found page (the cross-browser recovery text) still streams
  with status `200`.
- **Restart refreshes signed URLs.** `Phát lại` and the reduced-motion toggle call
  `router.refresh()`: the server re-validates the token, re-reads the draft and re-signs the URLs,
  then the client remounts `GiftViewer`. The template requests each photo once per `INIT`, so
  reusing URLs older than 300 s would show false `ASSET_UNAVAILABLE` issues.
- **Gift viewer.** `GiftViewer` (`modules/viewer/presentation/`) takes a ready source (preview) or
  a deferred source that loads the payload only on `Mở quà` (the public envelope renders without
  content). Its logic is the unit-tested `gift-viewer-controller.ts`: the iframe `src` is set only
  after the client `load` listener is attached, each `load` of that URL (never the initial
  `about:blank`) starts a 20 × 250 ms `INIT` budget, and `PLAY` is sent only after `READY`. Audio
  starts inside the `Mở quà` or `Tiếp tục` gesture (a deferred source unlocks the element in the
  gesture first). A page hidden while the gift plays, or while it is still opening, waits as paused
  for `Tiếp tục`.
- **Fallback rules.** On `ERROR`, an `INIT` timeout, no iframe `load` within 15 s, or no artifact,
  the host sends `DESTROY`, removes the iframe and renders every text and photo itself as plain
  text nodes and `no-referrer` images. After `assetsExpireAt` it fetches fresh URLs once. The
  switch is final for that mount.
- **Lifecycle notifications.** `opened`, `scene`, `completed` and `fallback` go to the host page
  through `onLifecycleEvent`, never anywhere else. The preview uses them for its own notices only;
  recipient analytics belong to the public page.

**Schema version 7 rollback.** The migration adds `previewTokens` (validator and TTL index) and the
`gift-preview` rate-limit scope. To roll back, redeploy the previous build: old code ignores
`previewTokens` and `gift-preview` counters expire. The old `db:verify` reports drift (the
`apiRateLimits` validator and ledger version `7`) until the old `db:migrate` runs, which restores
the version-6 validator and ledger. Validators apply only to writes, so existing counters are
unaffected, and leftover preview tokens expire through their TTL index.

## Publishing and the public Viewer

A signed-in owner publishes a draft, keeps editing it and publishes newer revisions, and a recipient
opens it at `/g/{shareId}` without an account. Behavior is specified in
`openspec/specs/gift-publishing` and `public-gift-viewer`.

- **Working copy and current publication.** A published gift keeps `content` and `revision` as its
  working copy, edited through the same draft API, autosave, preview and media routes as a draft.
  `publishedRevision` points at the current publication, the `giftPublications` record
  `{ giftId, revision }` that recipients receive (found through
  `gift_publications_gift_revision_unique`). The gift has unpublished changes exactly when
  `revision > publishedRevision`. Publishing again inserts a new record with the same `shareId` and
  moves the pointer in the same transaction, so recipients see the old publication or the new one,
  never a mix. Superseded records are kept and never served.

- **Publish checks.** `POST /api/gifts/{publicId}/publish` takes an `Idempotency-Key` and
  `{ expectedRevision, planId }`. `giftService.publishGift` finds the gift with the owner filter
  only (the anonymous cookie and preview tokens never authorize it), then replays a stored key
  (looked up by `{ giftId, revision }`), and requires status `draft` or `published`, the expected
  revision, for a published gift a revision newer than its current publication
  (`NO_UNPUBLISHED_CHANGES` otherwise) and an unexpired entitlement on the same plan, for a draft a
  plan the `PlanGrantPolicy` can grant, access mode `unlisted`, an editable version with a
  registered artifact, no content issue, and finally a photo count within the plan's `maxPhotos`. Content issues come from
  `collectContentIssues` (`modules/viewer/application/content-issues.ts`), the same function
  `buildViewerPayload` uses for the preview's server issues, so a revision whose preview lists no
  issue is exactly a publishable revision.
- **One transaction.** `mongoGiftRepository.publish` runs, in one MongoDB transaction: a replay
  check of the `gift-publish` key; the conditional write to `published` filtered by owner, access
  mode, revision and the state the checks saw (`draft`, or `published` with the same
  `publishedRevision` and an `expiresAt` after the write time), setting `publishedRevision` and
  `publishedAt` (and `shareId`, `entitlement` and `expiresAt` on a first publish only), keeping
  the revision; an `updateMany` with `$currentDate` on every referenced
  `ready`, non-detached asset of the gift and field, aborting when fewer match; the insert of the
  immutable `giftPublications` record; and the idempotency record. A failed condition aborts
  through a private sentinel, so nothing is written. A duplicate `{ giftId, revision }` from a
  concurrent update under another key answers `NO_UNPUBLISHED_CHANGES`. The domain passes
  `draft → publishing → published` (or `published → publishing → published`) in memory; only the
  final state is stored.
- **Why publish writes the assets.** Transactions use snapshot isolation and detect only
  write-write conflicts. Asset deletion reads its gift (editable status) and, for a published gift,
  the current publication's `assetIds` in the same transaction as its asset write. Without a write
  of its own to the asset, a publish checking "asset is ready" and a delete checking "no current
  publication uses it" could both commit (write skew). Because both transactions write the same
  asset document (`$currentDate` always changes it, and the delete's write does too), one of them
  aborts with a write conflict and is retried by `withTransaction`; the retry sees the committed
  state. The current publication can therefore never reference a deleted photo.
- **Detach instead of delete.** Deleting a photo that the current publication references detaches
  it from the working copy: it stays `ready` with its storage objects for recipients, its quota
  slots are released (`giftSlot`/`fieldSlot` become `null`, `detachedAt` is set), and it disappears
  from listings, reads, retries, deletions and save references. The `DELETE` answers `200` with
  `deleted: false`. Detached photos and those referenced only by superseded publications stay in
  storage until a cleanup job exists (risk register).
- **Plans and entitlement.** Plans are the versioned catalog `PLAN_CATALOG` in
  `packages/domain/src/billing` (`free@1`, `standard@1`;
  [ADR-0011](./adr/0011-versioned-plan-catalog.md)). The details are as follows:
  - **The grant.** A first publish grants the gift an `entitlement` snapshot of the current
    version of the requested plan (`grantEntitlement`). The snapshot is written in the same
    transaction, with `expiresAt = grantedAt + retentionDays`. Updates keep both, and every later
    check reads the snapshot, never the catalog.
  - **Who may grant what.** The port `PlanGrantPolicy` (wired in `composition/gifts.ts`) decides
    which plans can be granted. Free is always granted (`source: "free"`). Standard is granted only
    by the internal paid-plan grant (`config/internal-plan-grant.ts`,
    `INTERNAL_PLAN_GRANT_ENABLED`, `source: "internal"`), which is never on in Production. The
    checkout change adds the paid outcome
    ([ADR-0009](./adr/0009-billing-provider-boundary.md)).
  - **The Studio.** The Studio page renders the same policy's offers (`listPlanOffers`) into the
    editor, so the browser never holds plan constants.
  - **Expiry.** It is decided by server time on every request: the share lookup filters
    `expiresAt > now`, and an update write is conditional on it. A job only moves the stored status
    later.
  - **Watermark.** For a Free gift the `/g` page draws the host-level mark `Tạo bằng LoveMemory`
    over the frame, outside the template iframe. The template and the payload are unchanged.
- **Snapshot and pinning.** The publication stores `templateId`, `templateVersion`, the registered
  artifact's `contentHash` (`artifactContentHash`), the content, the asset ids and the audio track.
  No API updates or deletes it. `GET /api/public-gifts/{shareId}` calls `buildViewerPayload` with
  the publication's content and `expectedContentHash`, so a changed artifact gives
  `artifactUrl: null` and the static rendering instead of different code
  ([ADR-0004](./adr/0004-template-artifact-isolation.md)). The response drops `issues`.
- **Share links are bearer secrets.** A share id is 16 random bytes in base64url, assigned at the
  first publish and kept by every later publication of the gift, unique across `gifts`. Page and
  endpoint share one liveness check (format, published, `unlisted` and unexpired gift found through
  `gifts_share_id_unique`, the current publication by `publishedRevision` with the same share id,
  manifest) and answer one opaque not-found. The application never logs share ids, payloads or signed URLs; `/g/` sends
  `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` and `Cache-Control: private, no-store`;
  the payload endpoint is `no-store`; the envelope is rendered without content, and the payload is
  fetched only on `Mở quà`. The residual risk is the hosting platform's request logs, which keep
  `/g/{shareId}` paths: who can read them, their retention and the log-drain rule are recorded in
  the [deployment runbook](./runbooks/preview-deploy-and-rollback.md#share-links-in-platform-logs).
  Links cannot be revoked until the pause and delete work of Sprint 4 (plan.md §13.1–13.2); an
  update changes what a link shows, never the link.
- **Public read limits.** Each public read is charged to `public-gift-read` (network subject plus
  share id, 60 per 600 s) and `public-gift-read-ip` (network subject, 600 per 600 s). The subject
  is the trusted IPv4 address, or the `/64` prefix of an IPv6 address; sessions and cookies are
  never used. Keying the tight counter per link keeps many recipients behind one carrier-grade NAT
  address (common on Vietnamese mobile networks) from sharing one small budget, while the looser
  per-network cap bounds scanning, which 128-bit share ids make pointless anyway.
  "Trusted" means `x-vercel-forwarded-for` read only when `VERCEL=1`: off Vercel a client could
  send that header, so every request there falls back to the bounded `unidentified` subject. A
  limiter counter that two concurrent first requests both try to create is charged once by each
  (the loser of the upsert retries without upsert). The page render itself is not limited yet
  (Sprint 4 debt).

**Schema version 8 rollback.** The migration adds `giftPublications`, the optional `shareId` and
`publishedAt` fields with the partial unique index `gifts_share_id_unique`, and three rate-limit
scopes. It is additive: no existing document changes, and it upgrades a version-6 database in one
run too. Production cannot publish, so rolling back there is clean. On `dev` and `stg`, the previous
build's strict gift schema fails on published gifts: their Studio page and media routes answer
`500` and `/g/` does not exist. Prefer a roll forward; otherwise accept those errors for the few
test gifts, or first set `INTERNAL_PUBLISH_ENABLED=false` and move the published test gifts aside
with a reviewed one-off script (see the
[deployment runbook](./runbooks/preview-deploy-and-rollback.md#rolling-back-past-schema-version-8-published-gifts)).

**Schema version 10 rollout and rollback.** The migration adds `publishedRevision` to the `gifts`
validator and `detachedAt` to the `assets` validator, drops the legacy unique index
`gift_publications_share_id_unique` (a gift's later publications share its share id), and
backfills `publishedRevision = revision` on published gifts that predate it. Until it runs, the
repository reads a published gift without a pointer as `publishedRevision = revision`, a save
writes the pointer, and an update fails on the legacy index while recipients keep the first
publication. The previous build's strict schemas fail on both new fields, so a rollback on `dev`
or `stg` breaks published test gifts (see the
[deployment runbook](./runbooks/preview-deploy-and-rollback.md#rolling-back-past-schema-version-10-editable-published-gifts)).
The old `db:migrate` restores the version-7 validators and ledger and leaves the extra index in
place; re-deploying version 8 restores access without data repair.

**Schema version 11 rollout and rollback.** The migration adds `entitlement` and `expiresAt` to
the `gifts` validator. It backfills every published gift without an entitlement with `standard@1`
(`source: "legacy"`, the pinned `LEGACY_ENTITLEMENT`), granted at its `publishedAt` and expiring
365 days later.

- **Before the migration runs.** The repository reads such a gift with exactly that entitlement, so
  its Studio keeps working. Its share link answers `404`, because the lookup filters on the stored
  `expiresAt`.
- **Rollback.** From this version on, Production can publish Free gifts. The previous build's strict
  schema fails on both new fields, so a rollback breaks published gifts on every tier, Production
  included. Prefer a roll forward, and soak on `stg` before `main` (see the
  [deployment runbook](./runbooks/preview-deploy-and-rollback.md#rolling-back-past-schema-version-11-plans-and-entitlements)).

## Funnel analytics

First-party product funnel events, stored in MongoDB and never sent to a vendor
([ADR-0010](./adr/0010-first-party-funnel-analytics.md)). Behavior is specified in
`openspec/specs/funnel-analytics`; the code lives in `modules/analytics`, wired only in
`composition/analytics.ts`. `modules/analytics` imports no other module: the gift and public-gift
services declare the small ports they need (`AnalyticsContextFactory`, `PublishAnalytics`), and the
Studio tracker receives the editor store from `DraftEditor`.

- **Taxonomy and hook points.**

  | Event                                                        | Emitted by                                                                                                       |
  | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
  | `customization_started`, `required_content_completed`        | `trackStudioFunnel` on the Studio editor store: the first successful save, and the save that completes all steps |
  | `preview_started`                                            | `requestPreview`, just before the Studio navigates to the preview link                                           |
  | `publish_clicked`                                            | `requestPublish`, from the enabled `Xuất bản` action, before the save flush                                      |
  | `gift_published`                                             | `publishGift` on the server, for a first (not replayed) publish, written after the response with `after()`       |
  | `gift_open_interaction`, `scene_completed`, `gift_completed` | `createRecipientEventReporter` on the `GiftViewer` lifecycle of the public `/g` page only                        |

  The preview page and the Viewer harness never send events. A creator who opens their own `/g`
  link counts as a recipient: the page cannot tell them apart without identifying the viewer, so
  open and completion counts are upper bounds.

- **Privacy.** An event holds exactly `_id`, `name`, `giftRef`, `templateId`, `templateVersion`,
  `sessionId`, `sceneId`, `occurredAt` (server time) and `expiresAt`. No public id, share id, gift
  text, asset id, URL, e-mail, user id, cookie, IP address, user agent or client time is accepted
  or stored: the request schema is strict, and the server builds the record. `giftRef` is the
  HMAC-SHA-256 of `lm-gift-ref:v1:{internal gift id}` with the dedicated
  `ANALYTICS_GIFT_REF_SECRET`, handed only to pages that passed their access check (the owner's
  Studio and a live `/g`). Requests carry no credentials. The browser sends nothing under Global
  Privacy Control or Do Not Track, and nothing at all while analytics is disabled (no page context).
- **Transport.** One same-origin `fetch` per event, with `keepalive`, `credentials: "omit"`,
  `cache: "no-store"` and the request referrer policy `strict-origin`, never awaited and never
  retried. The default `cors` mode is deliberate: on `/g` and `/preview`, which send
  `Referrer-Policy: no-referrer`, a `no-cors` request (and so `navigator.sendBeacon`) would carry
  `Origin: null` and fail the same-origin guard. `strict-origin` keeps the Studio path, which holds
  the public id, out of `Referer`.
- **Sessions.** `sessionId` is a random UUID per gift and tab in
  `sessionStorage["lm:analytics:session:{giftRef}"]`, with an in-memory fallback when storage is
  blocked. Two gifts opened in one tab get two session ids, so a session never links gifts.
- **Endpoint, rate limits and bots.** `POST /api/events` checks the media type and origin, then
  answers `204` without storing for disabled analytics and automated user agents (missing, or
  containing `bot`, `crawler`, `facebookexternalhit`, `lighthouse`, `curl/` and the other listed
  substrings), then caps the body at 2048 bytes (`413`), validates it, and charges
  `analytics-event` (network subject plus session id, 60 per 600 s) and `analytics-event-ip`
  (network subject, 1200 per 600 s, ×5 for the shared `unidentified` subject). The network subject
  is the public read subject: the trusted IPv4 address or IPv6 `/64`, never a cookie.
- **Retention.** The TTL index `analytics_events_expiry_ttl` deletes an event 180 days after it was
  accepted. Every write is best-effort: a failure logs only an operation name and the request id,
  and never changes a page or the publish response.

| Data inventory    | Purpose                                                   | Fields                                                                                               | Retention            |
| ----------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------- |
| `analyticsEvents` | Where creators and recipients drop off in the gift funnel | `name`, `giftRef` (pseudonym), `templateId`, `templateVersion`, `sessionId`, `sceneId`, `occurredAt` | 180 days (TTL index) |

Analytics is on only when `ANALYTICS_ENABLED=true` and the secret has at least 32 characters. It is
off in Production until the Sprint 6 privacy copy (see the
[deployment runbook](./runbooks/preview-deploy-and-rollback.md#environment-variables)).

**Schema version 9 rollback.** The migration adds `analyticsEvents` with its validator and indexes,
and the two analytics scopes to the `apiRateLimits` validator. It is additive and also upgrades a
version-6 or version-7 database in one run. To roll back, redeploy the previous build: the old code
ignores `analyticsEvents`, and the analytics counters expire by TTL. The old `db:verify` reports
drift (the `apiRateLimits` validator and ledger version `9`); running the old `db:migrate`
restores the version-8 validator and ledger. The leftover `analyticsEvents` collection is no longer
managed, and its documents keep expiring through the TTL index that was already created. No gift,
publication or asset document is touched in either direction.

## Licensed audio catalog

Music a creator can attach to a gift comes only from the licensed audio catalog in
`packages/domain/src/audio/licensed-audio-catalog.ts`. Each track record carries its license
provenance and a content-addressed file name, `{id}.{first 16 hex of sha256}.{mp3|m4a}`. The
catalog is parsed when the module loads, so a malformed record fails tests and the build.

- **Add a track:** copy the file into `apps/web/public/audio-library/` under its content-addressed
  name, then append a record with `status: "active"` and the license reference (contract, invoice
  or license URL).
- **Withdraw a track:** set its `status` to `withdrawn`. Never delete the record or change its id,
  file or license, because stored gift content keeps resolving the id. A new recording is a new
  track.
- **Integrity gate:** `test/audio-library.test.ts` fails when a catalog file is missing, its size
  or SHA-256 differs from the record, or the directory holds a file no record references.
- **Delivery:** files are served as same-origin static assets under `/audio-library/` with
  `Cache-Control: public, max-age=31536000, immutable`. Browsers receive only a DTO with `id`,
  `title`, `artist`, `durationSec` and `url`; license data stays on the server.

Catalog audio is licensed product content, not user media, so it is not stored in the private Blob
store described by [ADR-0003](./adr/0003-object-storage-for-media.md). If the catalog outgrows
source control, move the files to a public store behind the same DTO `url`.

## Background jobs

Retryable work runs after the request that caused it has committed. Behavior is specified in
`openspec/specs/background-jobs`. Operations are in the
[background jobs runbook](./runbooks/background-jobs.md).

- **The outbox is the source of truth.** A job is inserted in the same transaction as the state
  that needs it (`enqueueJob` in `packages/database`, an upsert keyed by `deduplicationKey`). A lost
  dispatch therefore never loses work. Payloads hold identifiers only (ADR-0008).
- **Two runtimes share `jobOutbox`.**
  - `media.process.v1` keeps its own claim rules, statuses and Trigger.dev tasks
    (`media-processing`).
  - Generic jobs use `modules/jobs`:
    - `createJobRunner` claims the oldest due job of a registered type, validates its payload,
      runs the idempotent handler, and then completes it, retries it with backoff
      (`min(2^attempts × 30 s, 1 h)`), or moves it to `dead` with `lastErrorCode`;
    - a `processing` lease older than 10 minutes is claimed again.
  - Every query names its types, so neither runtime ever touches the other's jobs.
- **Dispatch** follows `MEDIA_WORKER_MODE`:
  - `inline` runs up to 10 steps right after the commit;
  - `trigger` asks for `jobs-drain`;
  - `jobs-sweep` runs every 5 minutes.

  A dispatch never fails the request that enqueued the work. `composition/gifts.ts` loads
  `composition/jobs` lazily, because the jobs composition builds on the gifts and media ones.

- **Handlers.** `gift.assets.cleanup.v1` (`modules/media/application/gift-assets-cleanup.ts`) is
  enqueued by every update publish. It deletes the detached photos that the current publication no
  longer references:
  1. a conditional move to `deleting`;
  2. the storage removals;
  3. `deleted`.

  The expired-asset cleanup of the media worker finishes any removal that failed. A detached photo
  can never be referenced by a save again, so no later publication can need it.

- **Health.** Readiness fails with `JobOutboxStalledError` when a generic job has been due for more
  than 10 minutes. This is a separate check from `MediaOutboxStalledError`.

**Schema version 12 rollout and rollback.**

- **Validator.** The `jobOutbox` validator allows `dead` and `lastErrorCode`.
- **Backfill.** `db:migrate` enqueues one cleanup job for each published gift that already has
  detached photos.
- **Rollback.** The previous build never writes generic jobs. Its `db:verify` reports drift, and its
  `db:migrate` restores the old validator, under which any remaining `dead` job no longer
  validates on update. Leave them untouched until the roll forward; nothing runs them meanwhile.

## Configuration

Each infrastructure boundary owns and validates its environment variables. Server-only URLs use
`APP_URL` and `ASSET_ORIGIN`; they are not exposed with a `NEXT_PUBLIC_` prefix. Invalid configured
values fail at the boundary instead of silently falling back to production localhost values.
`STORAGE_DRIVER` selects the object storage adapter: private Vercel Blob by default, or `local`
filesystem storage for development and Playwright only, which fails closed on any Vercel deployment
(see [the media pipeline runbook](./runbooks/media-pipeline.md#local-object-storage)).

## Why no service layer per entity?

Layers are used around business behavior, not mechanically for every file. A simple read-only catalog can be an application function plus repository interface. A publish flow earns a richer use-case, transaction boundary and outbox.
