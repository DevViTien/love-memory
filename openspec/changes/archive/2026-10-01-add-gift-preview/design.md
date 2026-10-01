# Design

## Context

See proposal.md for why this change exists. This design assumes the three earlier Sprint 3
changes are applied: `add-memory-box-template`, `add-schema-driven-studio` and
`add-local-object-storage`. Here is the state it builds on.

**Runtime host.**

- `apps/web/src/modules/templates/presentation/viewer-shell.tsx` is the only host. It is a
  diagnostic harness:
  - buttons `Phát`, `Tạm dừng` and `Hủy runtime`, and a status line;
  - the handshake: `INIT` on mount and on iframe `load`, resent every 250 ms for up to 20 attempts;
  - pause and `PAUSE · tab ẩn` on `visibilitychange`, and audio started from `Phát`.
- After `add-memory-box-template`, the harness also counts distinct `ISSUE` events and sends
  fixture `assets`.
- The bridge and the trusted-event check live in `packages/template-sdk` (`createTemplateBridge`,
  `readTrustedTemplateEvent`, `createMediaElementAudioController`).
- `template-artifact-registry.ts` resolves artifacts by exact id and version:
  `memory-box-spike@0.1.0`, and after `add-memory-box-template` also `memory-box@1.1.0`.
  `memory-box@1.0.0` stays retired, without an artifact, and existing drafts may still pin it.

**Media and audio.**

- `media-service.ts` signs derivative URLs with `storage.createDownloadUrl(key)`. The default TTL is
  300 s (`STORAGE_LIMITS.downloadUrlTtlSeconds`).
- `media-worker.ts` writes derivatives for target widths 320, 768 and 1280 with
  `withoutEnlargement`. A stored derivative's `width` is its real width, so a small source can
  produce several derivatives with the same width.
- `MediaAssetRepository.listByGiftId(giftId)` already exists.
- `audio-catalog.ts` exposes `isSelectableTrack` and `listSelectableTracks` (DTOs with a
  `/audio-library/{fileName}` URL).
- After `add-local-object-storage`, `composition/media.ts` builds the storage adapter for the
  selected driver. In local mode, signed URLs are same-origin `APP_URL` URLs, and the CSP
  `img-src` of both app and template documents includes that origin.

**Gifts.**

- `gift-service.ts` authorizes through `GiftRepository.findAuthorized(publicId, accessors)`.
- Route helpers provide `getGiftRequestContext`, `enforceGiftMutationRateLimit`,
  `giftServiceErrorResponse` and `requestId`.
- `validateJsonMutationRequest` and `readJsonBody` implement the mutation guards.
- `mongo-gift-rate-limiter.ts` defines `GiftMutationScope` and `RATE_LIMITS`.

**Studio.** After `add-schema-driven-studio`:

- the `preview` step renders `readiness-step.tsx` with a disabled button;
- the autosave controller exposes `flush(): Promise<FlushResult>`;
- `?field=<fieldId>` opens and focuses `studio-field-{fieldId}`.

**Database and CSP.**

- `packages/database/src/migrations.ts` is at `DATABASE_SCHEMA_VERSION = 6`. It reconciles
  validators and named indexes on every run, and verification compares them exactly.
- `getContentSecurityPolicyMode` maps `/studio`, `/viewer/` and `/g` to `nonce`.
- The root `app/loading.tsx` makes every page stream, so `notFound()` in a page renders the
  not-found UI with status `200` and a `noindex` meta tag. This is Next.js 16 behavior
  (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`, "Status
  Codes"), and it is what `/studio/{publicId}` does today.

**Governing ADRs.**

- **ADR-0001** (modular monolith): new `viewer` and `preview` modules, wired only in
  `apps/web/src/composition`.
- **ADR-0002** (native driver): a repository with explicit filters and a TTL index.
- **ADR-0003** (private object storage): only short-lived signed URLs, issued after
  authorization.
- **ADR-0004** (isolated template artifacts): the gift viewer uses the same sandbox and
  trusted-event rules.
- **ADR-0005** (route CSP modes): `/preview/` is a nonce route, and its layout calls
  `connection()`.

No decision contradicts an accepted ADR.

## Goals / Non-Goals

**Goals:**

- Preview and the published Viewer must use one transformation and one host component, so
  "preview == published" holds by construction (Gate M2).
- Keep all logic in `.ts` modules with unit tests: the transformer, the token service, the viewer
  controller, the static content model, the issue merging and the Studio action. The `.tsx` files
  only render.
- A template failure must never hide content. A missing artifact must never crash the preview.
- Leak nothing:
  - no token or signed URL in logs;
  - no gift text in metadata or public caches;
  - no token in `Referer`.

**Non-Goals:**

- Refactoring `ViewerShell` onto the new controller. The harness stays a diagnostic tool, and
  sharing only the SDK bridge keeps this change's diff away from `add-memory-box-template`'s edits.
- A public payload API. `add-temporary-gift-publish` adds `GET /api/public-gifts/{shareId}`, which
  returns the same `ViewerPayload`, and it will add the matching contract schema then.
- Caching viewer payloads or signed URLs.

## Decisions

### D1. Module layout

| Path                                                                          | Kind           | Responsibility                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules/viewer/application/viewer-payload.ts`                                | types          | `ViewerPayload` (`issues` optional for recipient responses), `ViewerField`, `ViewerIssue`, `ViewerIssueCode` (`CONTENT_MISSING` \| `CONTENT_TOO_FEW` \| `CONTENT_INVALID` \| `ASSET_UNAVAILABLE`), `issueKey()`, `ViewerSource` (`{ kind: "ready"; viewer }` \| `{ kind: "deferred"; load: () => Promise<ViewerPayload> }`), `ViewerLifecycleEvent`. |
| `modules/viewer/application/build-viewer-payload.ts`                          | pure + ports   | `buildViewerPayload(input, deps)` (D2).                                                                                                                                                                                                                                                                                                              |
| `modules/viewer/presentation/static-gift-content.ts`                          | pure           | `toStaticGiftBlocks(fields, payload, assets)` returns ordered text, date and image blocks (D5).                                                                                                                                                                                                                                                      |
| `modules/viewer/presentation/gift-viewer-controller.ts`                       | pure           | The host state machine (D5), with injected bridge factory, timers, audio controller and clock.                                                                                                                                                                                                                                                       |
| `modules/viewer/presentation/gift-viewer.tsx`, `static-gift-content-view.tsx` | React          | Rendering and event binding only.                                                                                                                                                                                                                                                                                                                    |
| `modules/preview/application/preview-token.ts`                                | pure           | `generatePreviewToken()`, `hashPreviewToken()`, `isPreviewTokenFormat()`, `PREVIEW_TOKEN_TTL_SECONDS = 1800`.                                                                                                                                                                                                                                        |
| `modules/preview/application/preview-service.ts`                              | service        | `createPreviewLink({ publicId, accessors })` and `openPreview(token)` with the ports `PreviewTokenRepository`, `GiftRepository`, `GiftTemplateRepository`, `MediaAssetRepository` (only `listByGiftId`), and the payload dependencies.                                                                                                               |
| `modules/preview/infrastructure/mongo-preview-token-repository.ts`            | infrastructure | `insert` and `findActive(hash, now)`.                                                                                                                                                                                                                                                                                                                |
| `modules/preview/presentation/preview-route-handler.ts`                       | presentation   | The `POST` handler, tested like the gift routes. `app/api/gifts/[publicId]/preview/route.ts` only re-exports it.                                                                                                                                                                                                                                     |
| `modules/preview/presentation/preview-issues.ts`                              | pure           | `mergePreviewIssues(fields, serverIssues, templateIssues)` and `describeIssue(field, issue)` (D6).                                                                                                                                                                                                                                                   |
| `modules/preview/presentation/preview-screen.tsx`, `issues-panel.tsx`         | React          | Controls, notice and panel.                                                                                                                                                                                                                                                                                                                          |
| `modules/gifts/presentation/studio/preview-action.ts`                         | pure           | `requestPreview({ flush, fetch, publicId })` returns an outcome (D7).                                                                                                                                                                                                                                                                                |
| `composition/viewer.ts`, `composition/preview.ts`                             | wiring         | `viewer.ts` supplies `buildViewerPayload`'s ports from the artifact registry, `audioCatalog` and the storage adapter exported by `composition/media.ts`. `preview.ts` exposes `getPreviewService()`, built from the Mongo repositories and those ports.                                                                                              |
| `app/preview/layout.tsx`, `app/preview/[token]/page.tsx`                      | routes         | `connection()`, the page metadata and a server render of `PreviewScreen`.                                                                                                                                                                                                                                                                            |

`modules/viewer` has no dependency on `modules/preview`, so `add-temporary-gift-publish` can use
it alone. Cross-module application imports follow the existing precedent: `media-service.ts`
imports `GiftAccessor` from the gifts application.

### D2. `buildViewerPayload`: one pure function with three ports

```ts
buildViewerPayload(
  { manifest, content, giftId, assets /* MediaAsset[] of the gift */, expectedContentHash? },
  {
    resolveArtifact: (id, version) => { contentHash: string } | null, // artifact registry
    signDownloadUrl: (key: string) => Promise<string>,                // storage.createDownloadUrl
    findSelectableTrack: (id: string) => LicensedAudioTrackDto | null, // audio catalog
  },
): Promise<ViewerPayload>
```

- **`artifactUrl`** is `/template-artifacts/{id}/{version}/{contentHash}/index.html` when
  `resolveArtifact(manifest.id, manifest.version)` returns a value, and `null` otherwise. There is
  never a fallback to another version, because a gift is pinned to its version (ADR-0004).
  Preview passes no `expectedContentHash`. `add-temporary-gift-publish` passes the publication's
  `artifactContentHash`. If the registered bytes ever differ from what the gift was published
  with, the result is `artifactUrl: null`, and the recipient gets the static rendering instead of
  different template code. Committed, hash-pinned releases (`add-memory-box-template`) make that
  case a defense in depth only.
- **`payload`** is `content` itself. A test asserts deep equality, and that no URL is ever added.
- **`assets`**:
  - `listImageFieldReferences(manifest, content)` from the SDK gives `{ fieldId, assetIds }` in
    order. That covers `imageList` and `captionedImageList`.
  - An id gets a URL only when an asset with that id exists in the gift's list, with
    `asset.fieldId === fieldId` and `status === "ready"`.
  - The derivative is the smallest `width >= 768`, or the widest when none reaches 768. This
    follows the real stored width, not the `w768` key name, so small sources and future width
    sets both work.
  - Signing runs in parallel. A gift has at most 30 assets (`MEDIA_ASSET_LIMITS`).
  - `assetsExpireAt` is `clock() + downloadUrlTtlSeconds`, taken before signing starts, so it is
    never later than the earliest URL expiry. It is `null` when no URL was signed. The TTL is a
    builder dependency: `composition/viewer.ts` passes `STORAGE_LIMITS.downloadUrlTtlSeconds`
    (300 s) both as `downloadUrlTtlSeconds` and to `createDownloadUrl`, so the application layer
    never imports the storage package and the two values cannot drift.
  - Assets are listed by `giftId`, so another gift's asset can never match. The field check stops
    one field's asset from appearing in another field. Draft saves already enforce this, but a
    stored payload is still treated as untrusted.
- **`audioUrl`** comes from `findSelectableTrack(value of the first audio field)?.url ?? null`.
  `AudioCatalogService` gains `findSelectableTrack(id)`, which returns the DTO only for `active`
  tracks.
- **`fields`** holds `{ id, label, type, required, minItems?, maxItems? }` in manifest order.
- **`issues`**:
  1. `createTemplatePayloadSchema(manifest).safeParse(content)`. For each Zod issue, take the first
     path segment as the field id, and a numeric second segment as `itemIndex`. The code is:
     - `CONTENT_MISSING` if the field's value is `undefined`;
     - `CONTENT_TOO_FEW` for a `too_small` issue on the array itself (path length 1, `origin`
       `array`). The panel reads `minItems` from `fields`;
     - `CONTENT_INVALID` otherwise, with `itemIndex` when present.
  2. `CONTENT_INVALID` for an audio value where `findSelectableTrack` returns `null`.
  3. `ASSET_UNAVAILABLE` with `itemIndex` for each referenced id without an `assets` entry.

  The result is deduplicated by `issueKey = code|fieldId|itemIndex` and sorted by field index,
  then `itemIndex`. Path segments that name no field, such as unknown keys, are dropped. The draft
  schema already rejects them on save.

- The function never logs, and it throws only if signing throws. The caller turns that into a
  `500`, or into an error page for the preview page.
- `issues` is creator feedback. The public endpoint of `add-temporary-gift-publish` drops it, and
  `GiftViewer` never reads it. Only the preview panel does.

_Alternative rejected:_ a client-side transformer. Signing needs storage credentials, and the
asset records must never reach the browser.

_Alternative rejected:_ putting `ViewerPayload` into `packages/contracts` now. No route returns it
in this change, and adding a schema without a production user goes against AGENTS.md.
`add-temporary-gift-publish` adds `ViewerPayloadDtoSchema` with the public endpoint, and it must
match these types. The types live in one file so that move is trivial.

### D3. Preview tokens: a bearer capability, stored hashed, checked on read

- **Format.** The token is `randomBytes(32).toString("base64url")`: 43 characters, 256 bits.
  `hashPreviewToken(token)` is the lowercase hex SHA-256. A plain hash is enough, because the
  input is uniformly random and a keyed hash adds nothing. `isPreviewTokenFormat` checks
  `/^[A-Za-z0-9_-]{43}$/` before any database access.
- **Document.** `previewTokens` stores `{ _id: tokenHash, giftId, createdAt, expiresAt }`, with
  `expiresAt = now + 1800 s`. A single `insertOne` writes it. A duplicate `_id` is practically
  impossible, and would surface as a `500`.
- **Issue.** `createPreviewLink`:
  1. `findAuthorized(publicId, accessors)`.
  2. Status `draft`, otherwise `NOT_FOUND`.
  3. `findEditableManifest(templateId, version)`, otherwise `INVALID_STATE`, which becomes `409`
     through `giftServiceErrorResponse`, exactly like `updateDraft`.
  4. Insert the token.
  5. Return `{ url: "/preview/" + token, expiresAt }`.

  The token exists only in the response body.

- **Open.** `openPreview(token)`:
  1. Check the format.
  2. `findActive(hash, now)` with the filter `{ _id: hash, expiresAt: { $gt: now } }`. TTL
     deletion runs about once a minute and is not a guarantee, so expiry is enforced by the
     filter (ADR-0002).
  3. `GiftRepository.findDraftById(giftId)` with the filter `{ _id: giftId, status: "draft" }`.
     This is new and only used here.
  4. `findEditableManifest`.
  5. `listByGiftId`, then `buildViewerPayload`, returning `{ publicId, viewer }`.

  Any `null` gives one `null` result, and the page calls `notFound()`.

- **Authorization model.** The token is a read-only bearer capability for one draft's content,
  checked inside the data-access filter. It is specified in `gift-draft-ownership` "Draft
  authorization" and not accepted anywhere else. A bearer token is what plan.md §12.2 asks for
  ("Preview token ngắn hạn"). It also lets the creator open the preview on a phone, which is
  where recipients will open the gift. There is no revocation. The 30-minute lifetime and the
  `draft`-only rule bound the exposure (see Risks).
- **Rate limit.** `gift-preview` allows 30 requests per 600 s per subject. The shared/network
  buckets use the usual ×5. It is added to `GiftMutationScope`, `RATE_LIMITS` and the validator
  enum. One click creates one token, and the Studio disables the button while a request runs.
- **Route order.** The route checks in this order:
  1. `validateJsonMutationRequest` (media type, origin);
  2. `PublicGiftIdSchema` (path);
  3. `getGiftRequestContext`;
  4. `enforceGiftMutationRateLimit(..., "gift-preview", id)`;
  5. `readJsonBody(CreateGiftPreviewRequestSchema)`, a strict `{}`;
  6. no accessors → `404`;
  7. the service.

  The success response is `createApiSuccessResponse({ url, expiresAt }, id, 201)`. Any other
  failure logs `{ event: "gift_preview_create_failed", requestId }` only.

- **Contracts.** `packages/contracts/src/gift.ts` gets `CreateGiftPreviewRequestSchema`
  (strict `{}`), `GiftPreviewLinkDtoSchema` (`url` regex `^/preview/[A-Za-z0-9_-]{43}$`,
  `expiresAt` ISO datetime, strict) and `GiftPreviewLinkResponseSchema`. The Studio parses the
  response with them.

- **Unthrottled page opens (accepted).** `GET /preview/{token}` and its `router.refresh()`
  re-renders are not rate limited. Each render costs:
  - one token lookup;
  - one gift read;
  - one manifest read;
  - one asset list;
  - up to 30 URL signatures (HMAC for local storage, an SDK call for Blob).

  Only a holder of a valid token can trigger more than the format check and one indexed `_id`
  lookup. Guessing is infeasible at 256 bits, and a holder is the creator, or someone the creator
  leaked the link to, for at most 30 minutes. Unknown tokens cost one indexed lookup, the same
  as any 404 page. This cost is accepted for Gate M2. If abuse shows up, a light per-IP limit on
  the page can reuse the `apiRateLimits` counters without a spec change to the token model.

_Alternative rejected:_ binding the token to the creator's session or cookie as well. The
preview could then not be opened on another device, and the draft routes already cover
same-browser access.

_Alternative rejected:_ a signed, stateless token (HMAC plus expiry). It needs no collection, but
it cannot carry a server-side lifetime change. Its expiry check is also no simpler, and future
revocation (Sprint 6 deletion) would need a deny-list collection anyway.

_Alternative rejected:_ reusing an unexpired token per gift. That needs a lookup by gift, and the
raw token would have to be stored to return it again.

### D4. `/preview/{token}` route, headers and not-found behavior

- **`app/preview/layout.tsx`** calls `await connection()`, like `/studio` and `/viewer`
  (ADR-0005).
- **`app/preview/[token]/page.tsx`** is a server component:
  - `export const dynamic = "force-dynamic"`;
  - `metadata = { title: "Xem trước quà", robots: { index: false, follow: false } }`. The root
    layout's title template `%s · LoveMemory` turns this into `Xem trước quà · LoveMemory`;
  - it awaits `getPreviewService().openPreview(token)` and calls `notFound()` on `null`;
  - it computes `canEdit` from `getGiftRequestContext` plus `findAuthorized(publicId, accessors)`
    (the Studio's own rule), so it never grants anything;
  - it renders `PreviewScreen` with `{ publicId, viewer, canEdit }`.

  Gift text never reaches `generateMetadata`.

- **CSP.** `getContentSecurityPolicyMode` sends `/preview` and every path under `/preview/` to
  the nonce branch. The template artifact iframe is same-origin, so `frame-src` falls back to
  `default-src 'self'`, as in the harness.
- **Headers.** `next.config.ts` `headers()` gets an entry for `/preview/:path*` with:
  - `Referrer-Policy: no-referrer`. It is listed after the global entry, and Next applies the last
    matching key;
  - `X-Robots-Tag: noindex`;
  - `Cache-Control: private, no-store`.

  Next.js also sets its own no-store `Cache-Control` for dynamic pages. The spec therefore
  requires only that the header _contains_ `private` and `no-store`, and the production-build E2E
  asserts that. `no-referrer` matters: signed images in the static fallback and any navigation
  from the page must not send the token URL to Blob or elsewhere. The template iframe already
  loads images with `referrerPolicy = "no-referrer"`.

- **Logs.** `logging.incomingRequests.ignore` gets `/^\/preview\//`. The option exists after
  `add-local-object-storage`, and this edit is additive. Page render failures go through the
  normal error boundary, and the service never logs.
- **Not-found status.** Because of the root `app/loading.tsx`, the not-found page streams with
  status `200`, a `noindex` meta tag and our `X-Robots-Tag` header. This is identical for every
  failure cause, so the response stays opaque, and it matches `/studio/{publicId}` today. The spec
  therefore says "renders the not-found page", not a status code.

  _Alternative rejected:_ a real `404` through `proxy.ts`. It would need a MongoDB lookup inside
  the proxy for every `/preview/` request, and the Next docs advise keeping proxy checks fast
  without content fetches.

  _Alternative rejected:_ moving the root `loading.tsx` into a route group. That is a site-wide
  restructuring for no user-visible gain in this change.

### D5. Gift viewer: controller state machine and static fallback

**Props.** `GiftViewer` takes:

- `source: ViewerSource`;
- `forceReducedMotion`;
- `muted` and `onMutedChange`;
- `onIssuesChange(issues)`;
- `onLifecycleEvent(event)`;
- `onAssetsExpired()`, used only for a ready source.

It has no preview-specific props, so `add-temporary-gift-publish` mounts it on `/g/{shareId}` with
a deferred source, and `add-funnel-analytics` subscribes to `onLifecycleEvent` without editing the
controller.

**State.** `gift-viewer-controller.ts` holds:

- `phase`: one of `envelope`, `loading-content`, `load-failed`, `opening`, `playing`, `paused`,
  `complete` or `destroyed`;
- `runtime`: `idle | loading | ready | fallback`, plus `fallbackReason` (`ERROR` |
  `INIT_TIMEOUT` | `LOAD_TIMEOUT` | `NO_ARTIFACT`);
- `viewer` (the current `ViewerPayload`, or `null` before a deferred load);
- `openRequested`, `muted`, `audioNotice`, `assetsRefreshed`, and the issue map keyed by
  `issueKey`;
- the internal `hiddenBeforePlay` flag: the page was hidden after the gesture but before the gift
  started (`opening` or `loading-content`).

**Inputs.** The component calls:

- `mounted()` from a client effect, after the iframe's `load` listener is attached. Only then
  does the component set the iframe `src`. React attaches `onLoad` during hydration, but an
  artifact served from the immutable cache can finish loading before that, and the event would be
  lost. The iframe is therefore rendered without `src` on the server. The effect sets `src`, and
  starts the 15-second load timer at that moment. With a deferred source, the iframe element is
  created only after the load succeeds, the same way.
- `attach(window, src)` on the iframe `load` event, with the iframe's current `src` attribute: it
  starts a new handshake with a new 20-attempt budget. A load while `src` is not the artifact URL
  (the initial `about:blank` document) is ignored, so it neither clears the load timer nor starts
  a handshake.
- `open()` from the `Mở quà` click and `retry()` from `Thử lại`.
- `resume()` from the `Tiếp tục` click.
- `setHidden(boolean)` from `visibilitychange`.
- `toggleMute()`, `imageFailed(index)` and `dispose()` on unmount.

Template events arrive through `readTrustedTemplateEvent` against the current iframe window.

**Transitions.**

- `READY`: stop the handshake and set `runtime = ready`. If `openRequested` and the phase is
  `opening`, begin playback: send `PLAY` once and go to `playing`, or go to `paused` without
  `PLAY` when `hiddenBeforePlay` is set.
- `open()` with a **ready source**:
  - start audio through `createMediaElementAudioController(audio).play()`, synchronously inside
    the click handler. A `blocked` or `failed` result sets `audioNotice`;
  - if the runtime is `ready`, send `PLAY` and go to `playing`;
  - if it is `loading`, go to `opening` (`Đang mở quà…`);
  - if it is `fallback`, go to `playing` and show the static content.
- `open()` or `retry()` with a **deferred source**, still inside the click handler:
  1. Call `play()` on the pre-created audio element, which has no `src`. This registers user
     activation for the element in Safari and Chrome, and the expected rejection is ignored.
  2. Call `load()` and go to `loading-content` (`Đang mở quà…`).
  3. On success, store the viewer and create the iframe (or go straight to the fallback when
     `artifactUrl` is `null`). If there is an `audioUrl`, set `audio.src` and call `play()`,
     classifying the result as usual, unless `hiddenBeforePlay` is set. The `PLAY` follows
     `READY`.
  4. On failure, go to `load-failed` (`Chưa mở được món quà…` and `Thử lại`), with nothing
     rendered from content.
- `SCENE`: stays `playing` and emits `scene`. `COMPLETE`: goes to `complete` and emits
  `completed` once.
- `ERROR`, or 20 attempts after the latest load without `READY`, or no `load` within 15 000 ms of
  setting `src`: send `DESTROY`, disconnect, set `runtime = fallback`, and emit `fallback` with its
  reason. The switch is final for this mount. A switch during `opening` begins playback as for
  `READY` (so `paused` when `hiddenBeforePlay`). The `NO_ARTIFACT` switch detected in `mounted()`
  emits `fallback` in a microtask, and only if the controller is not disposed by then: React's
  Strict Mode double mount discards the first controller synchronously.
- Hidden while `playing`: send `PAUSE`, pause audio, go to `paused`. Hidden while `opening` or
  `loading-content`: pause audio and set `hiddenBeforePlay`, so the later `READY`, deferred load or
  fallback goes to `paused` without `PLAY` or audio. Hidden in other phases: pause audio only.
  `resume()`: clear `hiddenBeforePlay`, send `PLAY` when the runtime is `ready`, play audio (inside
  the gesture), go to `playing`. A new `Mở quà` or `Thử lại` gesture clears the flag too.
- `ISSUE`: add it to the map and notify `onIssuesChange` with the sorted distinct list. An `INIT`
  is only resent with the same payload and context during the handshake, so the map is reset only
  when the component remounts (D6).
- `opened` is emitted when `open()` has content, which is at once for a ready source, or after a
  successful deferred load.

**Asset expiry in the static fallback.** Two events trigger a refresh:

- the fallback is shown when `now >= viewer.assetsExpireAt`;
- `imageFailed(index)` is reported after that time.

Then, if `assetsRefreshed` is false, the controller sets it and gets fresh URLs:

- a deferred source calls `load()` again, and only `assets` is replaced;
- a ready source calls `onAssetsExpired()`, and the host passes a new `viewer` prop without
  remounting (D6).

A second failure shows the caption. The template path needs no refresh, because the template
preloads each photo once per `INIT` (`add-memory-box-template` D7).

_Alternative rejected:_ preloading all fallback images at mount. Every photo would be downloaded
twice, since private `no-store` responses are not reused, even when the template works.

`PLAY` is never sent while the runtime is `loading`. This is the `template-viewer-runtime` "PLAY
only after READY" rule, and `add-memory-box-template`'s hold-early-`PLAY` behavior stays a safety
net only.

**Timeouts.** The load timeout (15 s, counted from setting `src`) plus the per-load handshake
budget (20 × 250 ms) means a slow 3G artifact load does not trigger the fallback. A hung or crashed
runtime still falls back within about 5 s of loading.

**Static fallback.** `toStaticGiftBlocks(fields, payload, assets)` maps the content by field type:

| Field type                        | Block                                                           |
| --------------------------------- | --------------------------------------------------------------- |
| `shortText`, `longText`           | text block (line breaks kept with `white-space: pre-line`)      |
| `date`                            | text `DD/MM/YYYY`, parsed as a calendar date without time zones |
| `imageList`, `captionedImageList` | per item: `{ url?, caption?, index }`                           |
| `theme`, `audio`                  | skipped                                                         |

Wrong-typed values are skipped. The same untrusted-input stance as the template applies. The
`.tsx` renders the blocks with React text nodes only. Images use `referrerPolicy="no-referrer"`
and an `onError` that swaps in the caption or `Ảnh {n}`. Everything is inside a scrollable region
labelled `Nội dung món quà`, and nothing animates.

**Accessibility.**

- The iframe has `aria-hidden="true"` and `tabIndex={-1}` while the envelope is shown.
- After opening, focus moves to the iframe, or to the static region's heading. When the fallback
  replaces the template after opening, focus moves to the static region's heading.
- `Mở quà`, `Tiếp tục` and `Tắt tiếng`/`Bật tiếng` are native buttons at least 44 × 44 px.
- The iframe title stays `LoveMemory template viewer` (`template-viewer-runtime` "Sandboxed
  opaque-origin iframe").

_Alternative rejected:_ extending `ViewerShell`. Its status text, `Phát` button and diagnostics
are harness features. Mixing both would grow a component that `add-memory-box-template` is editing
in parallel, and a `.tsx` component cannot be covered by the per-file coverage gate.

### D6. Preview screen: controls, restart and issues

- `PreviewScreen` (client) keeps `viewport`, `forcedReducedMotion`, `muted` (passed down so it
  survives restarts) and `templateIssues`.
- The viewport switch changes only the frame's CSS:
  - `Điện thoại`: `aspect-[9/16] max-w-sm mx-auto`;
  - `Máy tính`: `aspect-[16/10] w-full`.

  The iframe is not re-mounted, so no new `INIT` is sent.

- **Restart and the reduced-motion toggle** call `router.refresh()` (`next/navigation`). The
  server re-runs `openPreview`: it re-validates the token, re-reads the current draft and
  re-signs the URLs. Then `PreviewScreen` increments a client-side `generation`, and `GiftViewer`
  remounts through `key={generation}`. The unmount sends `DESTROY`. The key is a client counter,
  not a server timestamp, so the fallback's `onAssetsExpired` can also call `router.refresh()`.
  That hands the same mounted `GiftViewer` a new `viewer` prop with fresh URLs, without
  restarting the gift.

  The refresh is needed. `add-memory-box-template` requests each photo URL at most once per
  accepted `INIT`, and a different `INIT` (such as a new reduced-motion context) re-requests every
  photo. Reusing URLs older than 300 s would give false `ASSET_UNAVAILABLE` issues. An expired
  link makes the refresh render the not-found page, which is the specified behavior.

  _Alternative rejected:_ a separate JSON endpoint for fresh URLs. It would add a second
  token-authorized route to protect, while `router.refresh()` reuses the page and its checks.

  _Alternative rejected:_ longer signed URLs for preview. That breaks the uniform 300 s rule of
  `media-upload`.

- **Issues.** `mergePreviewIssues(fields, viewer.issues, templateIssues)`:
  - it deduplicates by `issueKey` and sorts by field order and `itemIndex`;
  - it maps each issue to `{ message, href }`, where `href = /studio/{publicId}?field={fieldId}`;
  - it groups unknown field ids into one unlinked entry.

  The fallback notice comes from the viewer's `fallbackReason`. Under `NO_ARTIFACT` it is replaced
  by the "no animation" notice, because a missing artifact is not a template error.

- `Sửa` and `Quay lại chỉnh sửa` are plain `<Link>`s. They leave the preview tab and go back to
  the Studio, where the D7 deep link focuses the field. They are rendered only when `canEdit` is
  true (D4). Otherwise, for example for a link opened on the creator's phone, the panel shows
  `Mở Studio trên thiết bị đã tạo quà để sửa.` instead of links that would end in the not-found
  page.
- `PreviewScreen` passes no `onLifecycleEvent` handler that reports anything. Preview must never
  produce recipient events such as `gift_open_interaction` or `gift_completed`.

### D7. Studio `Xem trước` action: flush, then same-tab navigation

`preview-action.ts` works in three steps:

1. `const flushed = await controller.flush()`. Anything other than `saved` returns
   `{ kind: "blocked" }`, and the store already shows why.
2. `POST /api/gifts/{publicId}/preview` with `{}` and `Content-Type: application/json`.
3. It classifies the response:
   - `201` with a valid `GiftPreviewLinkResponseSchema` gives `{ kind: "open", url }`;
   - `429` gives `{ kind: "rate-limited", retryAfterSeconds }`;
   - `404` gives `{ kind: "gone" }`, which calls the store's existing non-editable path;
   - anything else, including a network error, gives `{ kind: "failed" }`.

`readiness-step.tsx` renders the button, holds a `busy` flag, and on `open` calls
`window.location.assign(url)`. The flag stays set while the page navigates away; a `pageshow`
event with `persisted === true` (the page restored from the back/forward cache) clears it. The Studio's unmount flush (`keepalive`) is a no-op, because the
draft was just saved.

_Alternative rejected:_ opening the preview in a new tab with `window.open`. Browsers block
popups that open after an `await`. The two open Studio tabs would also race on revisions, because
`Sửa` leads back into the Studio.

The `Xuất bản` button stays disabled with `Sắp ra mắt` until `add-temporary-gift-publish`.

### D8. Database schema version 7

- `COLLECTIONS.previewTokens = "previewTokens"`.
- A new entry at the end of `CORE_COLLECTION_DEFINITIONS`:
  - the validator requires `_id` (string, `^[a-f0-9]{64}$`), `giftId` (string, `minLength` 1),
    `expiresAt` (date) and `createdAt` (date), with `additionalProperties: true` like the others;
  - the index `preview_tokens_expiry_ttl` on `{ expiresAt: 1 }` with `expireAfterSeconds: 0`.
- `apiRateLimits` `scope.enum` gains `gift-preview`. The validator is replaced on migrate, as
  specified.
- `DATABASE_SCHEMA_VERSION = 7`.
- `migrations.test.ts` asserts the new collection, validator and TTL index, and the drift
  detection still works.
- There is no index on `giftId`. No query in this change filters by it. Sprint 6 deletion can add
  one with its own query.
- The collection registry spec lists names alphabetically, so `previewTokens` goes between
  `paymentAttempts` and `reactions`. In the code it is appended. Order does not matter to the
  migration.

### D9. MODIFIED requirement provenance (re-diff before apply)

| Capability                   | Requirement                                                                                                       | Based on                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `studio-editor`              | Studio preview and publish steps                                                                                  | `add-schema-driven-studio` delta (ADDED there)                                                      |
| `template-viewer-runtime`    | Lifecycle control                                                                                                 | `add-memory-box-template` delta (MODIFIED there)                                                    |
| `template-viewer-runtime`    | Initialization handshake; Pause when the page is hidden; Audio only after a user gesture                          | `openspec/specs/` at proposal time (no earlier Sprint 3 change)                                     |
| `gift-draft-ownership`       | Draft authorization                                                                                               | `openspec/specs/` at proposal time                                                                  |
| `mutation-request-guards`    | Distributed mutation rate limits                                                                                  | `openspec/specs/` at proposal time                                                                  |
| `content-security-policy`    | Route-based policy mode selection; Nonce routes are dynamically rendered                                          | `openspec/specs/` at proposal time. `add-local-object-storage` modifies other CSP requirements only |
| `database-schema-management` | Collection registry; JSON-schema validators; Named indexes; Idempotent migration with ledger; Schema verification | `openspec/specs/` at proposal time. `add-memory-box-template` modifies only "Template catalog seed" |

Task 1.1 re-diffs each block against `openspec/specs/` once the three earlier changes are
archived.

- **Expected differences.** The two blocks based on earlier deltas become exact matches plus this
  change's edits. The others must be unchanged apart from this change's edits.
- **Expected gate warning until then.** `node --import tsx scripts/check-openspec.ts` warns that
  `studio-editor` "Studio preview and publish steps" does not exist yet in `openspec/specs/`.
  `openspec validate` reports an INFO that archive would refuse the delta. Both clear once
  `add-schema-driven-studio` is archived.
- **Waiver.** "Schema verification" intentionally replaces the backticked identifier
  `MongoDB schema version mismatch: expected 6, received 1.` with the version-7 message. The
  `modifiedBodyDrop` waiver for `add-gift-preview` / `database-schema-management` / "Schema
  verification" is already recorded in `openspec/gate-exceptions.json` (owner `DevViTien`,
  expires `2026-10-31`). It is removed when the change is archived (task 10.3), and must be
  extended by its owner if archiving slips past that date.

### D10. Notes for the later Sprint 3 changes

- **`add-temporary-gift-publish`:**
  - render the `/g/{shareId}` envelope server-side, and mount
    `GiftViewer` with `{ kind: "deferred", load: () => fetch("/api/public-gifts/{shareId}") }`;
  - pass `expectedContentHash` = the publication's `artifactContentHash` to `buildViewerPayload`;
  - drop `issues` from the public response;
  - add `ViewerPayloadDtoSchema` to `packages/contracts` for that endpoint.
- **`add-funnel-analytics`:**
  - map `onLifecycleEvent` (`opened`, `scene`, `completed`, `fallback`) to its events on `/g/`
    only;
  - `/preview/` sends `Referrer-Policy: no-referrer`, and a `no-cors` POST or a `sendBeacon` from
    such a page carries `Origin: null`, which the same-origin guard rejects. So events from
    `/preview/` must either use `fetch` with `credentials: "same-origin"` in `cors` mode (which
    carries the real `Origin`), or not be sent at all. The preview's own `preview_started` is
    better sent from the Studio before navigating.

### D11. Tests

- **Unit** (Vitest, next to the code):
  - `build-viewer-payload.test.ts`: every `viewer-payload` scenario, with fake ports;
  - `preview-token.test.ts`;
  - `preview-service.test.ts`: fake repositories, and every open/issue failure mapping to `null`
    or its error;
  - `mongo-preview-token-repository.test.ts`: the mocked `getDatabase`, the filter shape including
    `expiresAt: { $gt }`, and the hash stored as `_id`;
  - `preview-route-handler.test.ts`: `201`/`404`/`409`/`415`/`400`/`429`/`500`, and that the log
    line has no token;
  - `gift-viewer-controller.test.ts`: fake timers and a fake bridge, covering every `gift-viewer`
    scenario. That includes both source kinds, a deferred load failure and retry, deferred audio
    unlock, an early tap, a slow load, a `load` that happens before `mounted()` (it must not
    count), `ERROR` before and after opening, visibility, audio results, lifecycle events and the
    one-time asset refresh;
  - `static-gift-content.test.ts`;
  - `preview-issues.test.ts`;
  - `preview-action.test.ts`;
  - `content-security-policy.test.ts` additions;
  - `migrations.test.ts` additions;
  - `mongo-gift-rate-limiter.test.ts` for the scope limit;
  - contracts tests;
  - `audio-catalog.test.ts` for `findSelectableTrack`.
- **Component** (`.tsx` tests, not coverage-gated): the envelope, mute and fallback rendering in
  `gift-viewer.test.tsx`; the controls and panel in `preview-screen.test.tsx`; the enabled button
  and busy state in `readiness-step.test.tsx`. As the brief requires, they use no jest-dom
  matchers.
- **E2E** (`apps/web/e2e/preview.spec.ts`, production build, local object storage; see task 9.1).
  The coordinator runs it after merging, never inside a worktree.

## Risks / Trade-offs

- **[Risk] A leaked preview link exposes draft content for up to 30 minutes.** → Mitigations:
  - the link is never shown for copying;
  - `no-referrer` and `noindex` are set;
  - the link stops working when the gift leaves `draft`;
  - tokens are stored hashed, so a database read does not yield usable links;
  - the page notice tells the creator not to share it.

  Revocation is left out of scope.

- **[Risk] Hosting platform access logs record the request path, and so the token.** → The
  application never logs it, and the development log ignores `/preview/`. Platform logs are
  access-controlled and the token lives 30 minutes. A fragment-based URL (`/preview#token`) would
  avoid this, but it needs a client-side payload fetch. This is recorded as a possible Sprint 6
  hardening (Out of scope).
- **[Risk] The not-found page streams with status `200`** (D4). → The response is identical for
  every failure and `noindex` (header and meta). The E2E asserts the not-found text and headers,
  not the status.
- **[Risk] Signed URLs expire while a preview stays open for longer than 300 s.** → The template
  requests each photo once per `INIT` and keeps the element. `Phát lại` and the reduced-motion
  toggle refresh the URLs (D6). A static fallback shown after `assetsExpireAt` gets fresh URLs
  once (D5).
- **[Trade-off] The gift viewer duplicates part of `ViewerShell`'s handshake logic.** → Both
  share the SDK bridge and the trusted-event check, and the duplicated part (timers) is small and
  unit-tested in the controller. Converging the harness onto the controller can follow once
  `add-memory-box-template` has merged.
- **[Risk] Merge order.** This change edits files the earlier changes also touch:
  - `next.config.ts` (all three), `readiness-step.tsx` and `draft-editor.tsx`
    (`add-schema-driven-studio`);
  - `composition/media.ts` (`add-local-object-storage`);
  - `audio-catalog.ts`.

  → All edits are additive (a new headers entry, a new ignore pattern, a new export, a new
  method). Apply starts only after the three changes are merged (task 1.1).

- **[Risk] `router.refresh()` keeps client state but may reuse the old props if the server render
  fails.** → An error renders the route's error boundary. A token that expires mid-session shows
  the not-found page, as specified.

## Migration Plan

1. Deploy runs `pnpm db:migrate` (the deployment runbook step is unchanged). It creates
   `previewTokens`, updates the `apiRateLimits` validator and records version `7`. This is purely
   additive.
2. Ship the code in the same deployment. The new route and page have no effect until the Studio
   button is used.
3. **Rollback:** redeploy the previous build.
   - The old code ignores `previewTokens`, and `gift-preview` counters simply expire.
   - The old `db:verify` would report drift: the `apiRateLimits` validator and ledger version `7`.
     Running the old `db:migrate` restores the version-6 validator and ledger. MongoDB validators
     apply only to writes, so existing counters are unaffected.
   - The leftover `previewTokens` collection is not managed by version 6, and its documents
     expire through the TTL index already created.

   `docs/architecture.md` records this note.
