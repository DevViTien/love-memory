# Design

## Context

See proposal.md for the motivation. The findings come from three read-only reviews of
`3b780e9..feat/sprint-3`. Their disposition is recorded in `docs/sprints/sprint-3-review.md`:
`ACCEPT`, `ACCEPT-DEFER` (moved to the Sprint 4 debt list) or `REJECT`.

Every fix stays inside existing modules and ports:

- no new route, collection, index, migration or environment variable;
- `VERCEL` is set by the platform, so reading it adds no configuration.

The governing ADRs are named next to each decision.

## Goals / Non-Goals

**Goals:**

- Fix the accepted findings with the smallest change in the existing style, with tests next to the
  code.
- Keep every security invariant exactly as it is, or tighten it.

**Non-Goals:**

- Restructuring the rate limiter or the route composition (deferred, see the proposal's
  Non-goals).
- Any Product Owner decision from Bucket B.

## Decisions

### D1. Availability = "a template artifact is registered for the exact version"

The registry (`template-artifact-registry.ts`, ADR-0004) is the only source of truth for whether a
version can run. Alternatives:

- **Seed placeholder versions as `draft`.** Rejected. It would also hide them from the catalog,
  which the PO wants to show as "Sắp ra mắt". It would also change the seeded launch templates
  requirement, and it does not cover a retired version without an artifact.
- **Add a stored `available` flag.** Rejected. It could drift from the code that actually serves
  artifacts.

Implementation:

- `TemplateSummary` gains `available`. The templates application functions take an
  `isAvailable(id, version)` port, wired in `composition/templates.ts` to `getTemplateArtifact`.
- `GiftService.createDraft` refuses with `NOT_FOUND` when `publishing.artifacts.resolve` returns
  `null`. This is the same resolver that publish already uses. When `publishing` is not
  configured (unit tests of drafts only), the check is skipped.
- The Studio page passes `publishable` (from the same resolver, through `composition/gifts.ts`) to
  `DraftEditor`. The editor then shows the notice and disables `Xuất bản` before any work, not
  after a `409`.

### D2. Automatic claim on the Studio page (server side)

`app/studio/[publicId]/page.tsx` calls `giftService.claimDraft` before rendering when all of these
hold:

- the request has a user;
- the draft is anonymous;
- the request carries an anonymous identity.

The claim write is the existing repository filter (`publicId`, both anonymous credentials,
`ownerId: null`, `status: "draft"`), so authorization stays inside the data-access filter (AGENTS
invariant). The page then renders the returned owned DTO.

Alternatives:

- **A client effect that calls `POST /claim`.** Rejected. It flashes the anonymous state, needs a
  second round trip, and can be blocked by the `gift-claim` rate limit.
- **Claim inside the Better Auth callback.** Rejected. The magic link's callback URL is a page, and
  adding a custom callback route widens the auth surface.

GET with a side effect:

- The page is `force-dynamic`, and dynamic pages are not prefetched beyond their loading boundary.
- A cross-site top-level GET can only claim the victim's own anonymous draft into the victim's own
  account, because both cookies are the victim's.
- So this adds no new risk.

The claim is idempotent: a second render sees an owned draft and does nothing.

The Studio not-found page (`app/studio/[publicId]/not-found.tsx`) is static and identical for every
cause, so it stays opaque.

### D3. Publish confirmation, freeze and read-only states in the store

- `DraftEditorStore` gains `publishing: boolean` with `setPublishing`. While `publishing` or
  `readOnly` is set, `setFieldValue` returns the unchanged state. Text, date and select inputs and
  the image field receive `disabled`. The image field disables its picker and every item action,
  and its late `onChange` calls are ignored by the store guard.
- `selectShouldWarnOnLeave` returns `false` when `readOnly`.
- `PublishStep` renders the confirmation in place of the button. `publish_clicked` is reported when
  the creator chooses the enabled `Xuất bản`, which keeps the `funnel-analytics` wording ("before
  the save flush and the publish request"). `Xác nhận xuất bản` calls `setPublishing(true)`, then
  `requestPublish`, and clears the flag on every outcome except `published`.
- Because edits are impossible during the request, the self-inflicted `409` described by DEV-M3
  cannot happen, so no "own revision" comparison is needed.

### D4. Client request timeouts with `AbortController`

A small helper `fetchWithTimeout(fetch, input, init, milliseconds)` lives in
`apps/web/src/http/fetch-with-timeout.ts`. It is client-safe: it uses only an `AbortController`
and `setTimeout`, so fake timers can drive it. On expiry it aborts, and the caller sees a rejected
fetch, which every caller already maps to its network-failure outcome.

`AbortSignal.timeout` was not chosen, because Vitest fake timers do not drive it.

| Request                    | Limit | Outcome on expiry                                     |
| -------------------------- | ----- | ----------------------------------------------------- |
| Save `PATCH`               | 15 s  | `transient` or `offline` (by `navigator.onLine`)      |
| Draft reload `GET`         | 15 s  | `failed`                                              |
| Preview `POST`             | 15 s  | `failed`                                              |
| Publish `POST`             | 30 s  | `failed`; the retry reuses the same `Idempotency-Key` |
| Upload init and completion | 15 s  | the existing error paths                              |

A save sent with `keepalive` while the page unloads also carries the timeout. The browser may drop
the timer on unload, which is harmless.

For the upload transfer (XHR), a stall timer restarts on every `progress` event and aborts after
30 s without progress. A total timeout was rejected: a legitimate 1–2 MB crop on 3G can take
longer than any sensible total.

### D5. Interrupted transfer cleanup

On a transfer error that is not a cancellation, the field calls the existing delete path for the
new asset, removes the item and reports the order. If the delete fails, the item stays with `Xóa`.

Retaining the `File` and re-uploading to the same grant was rejected:

- grants expire;
- local storage refuses overwrites;
- a re-init creates a new asset anyway.

Recovery after a reload still offers the complete-upload action. In that case the transfer may
have finished, and only the completion was lost.

### D6. Bounded `giftRevisions` in the save transaction

`mongoGiftRepository.updateDraft` already runs a transaction (ADR-0002). After inserting revision
`n`, it runs `deleteMany({ giftId, revision: { $lt: n - 19 } }, { session })`. The unique
`gift_revisions_identity_unique` index (`giftId`, `revision`) serves the filter, so no index or
migration is needed. Revision `0`, written at creation, is pruned like any other once 20 newer
revisions exist.

Alternatives:

- **A TTL index.** Rejected: it needs a migration, and a draft left alone keeps its history.
- **Coalescing.** Rejected: it changes the one-snapshot-per-revision rule.

The data inventory in `docs/architecture.md` records the retention.

### D7. Rate limiter: duplicate-key retry and Vercel-only header trust

- **Duplicate-key retry.** On `E11000` from the upsert, the limiter retries once with
  `findOneAndUpdate({ _id, count: { $lt: max } }, …, { upsert: false })`, and `null` means the
  bucket is exhausted. This is the documented pattern for a non-equality upsert filter.
- **Header trust.** `trustedForwardedAddress` returns `null` unless `process.env.VERCEL === "1"`.
  - Every subject helper reads this one function, so the mutation, public-read and analytics
    subjects stay consistent.
  - The E2E server never sends `x-vercel-forwarded-for`. Its per-context addresses use
    `x-forwarded-for` for Better Auth only, so the suite is unaffected.
- **Analytics charging.** The spec is changed to match the code. Charging the network counter
  only after the session counter allowed the request is the better behavior: one flooding tab
  cannot exhaust its network's budget.

### D8. Route failures logged with `reportOperationalFailure`

Every catch in these handlers calls `reportOperationalFailure(operation, error, id)`, which records
only `errorName`, `operation` and `requestId`:

- the draft routes;
- publish and preview;
- the public gift handler.

Messages are never logged, because a Mongo error message can echo a filter value. The same
handlers pass `maxBytes` to `readJsonBody`: 1 KiB for publish and preview, 64 KiB for `PATCH`.
The existing `413` response is reused. 64 KiB is about eight times the largest `memory-box@1.1.0`
content.

### D9. Real `404` for `/g` and `/preview` via a route group

The root `app/loading.tsx` wrapped every segment in Suspense, so `notFound()` ran after the `200`
had been streamed (Next 16 `not-found.md`, "Status codes"). The home page and its loading UI move
into `app/(home)/`, with no URL change.

- `/g` and `/preview` then render their not-found page before the shell flushes. A production
  build answers `404` (checked with Playwright before writing this design).
- `/templates` and `/studio/[publicId]` keep their own `loading.tsx`. The Studio not-found page
  therefore still streams as `200`, which is documented.
- Moving the liveness check into `proxy.ts` was rejected: it would need a database read in the
  proxy for every request.
- CSP and caching are unchanged. The route table keys on paths, and the paths are unchanged.

### D10. Gift viewer fixes

All of these sit inside the controller and the component (ADR-0004, sandbox unchanged):

- **Iframe creation.** The iframe is rendered only once `frameSrc` is set, so React creates it
  with `src` and attaches the `load` listener before insertion. The "initial blank document load"
  can then not be observed. `attach` still ignores a `load` whose `src` attribute differs.
- **Image refresh.** When the deferred refresh rejects, or a ready source's refresh does not
  arrive within 10 s, the image that triggered `refreshAssets()` is added to `failedImages`.
- **Audio after `COMPLETE`.** `setHidden(true)` in phase `complete` records that the hide paused
  the audio, and `setHidden(false)` resumes it. The component now forwards visible transitions
  too.
- **Focus.** The opening status gets `tabIndex={-1}` and receives focus while shown. `Tiếp tục`
  and `Thử lại` receive focus when they appear.
- **Analytics.** The recipient reporter ignores a `scene` notification for the current scene
  (QA D-8). This is a bug fix under the existing spec ("when the next scene starts").

### D11. Public payload from the snapshot

`MediaAssetRepository` gains `listByIdsForGift(giftId, assetIds)`, with the filter
`{ _id: { $in }, giftId }` served by `_id`. `PublicGiftService.openPublicGift` reads exactly
`publication.assetIds`. `buildViewerPayload` still signs only `ready` assets. Authorization
remains the liveness check plus the gift id in the filter.

### D12. Hygiene and guard

- **`listImageFieldReferences`.** Skips items that are not objects or have no string `assetId`.
  Stored content is untrusted input.
- **`withFieldValue`.** Returns the same content object when the new value is deep-equal, so the
  store's existing identity check suppresses no-op notifications.
- **`getGiftRequestContextFromHeaders(headers)`.** Pages call it instead of building a fake
  `Request`.
- **Duplicated helpers.** The duplicated `requestId` and the `429` response builder fold into
  `http/api-response.ts` (`createRateLimitedResponse`).
- **ESLint guard.** A `no-restricted-imports` block for `apps/*/src/modules/*/presentation/**`
  bans `../infrastructure/*` and `@/modules/*/infrastructure/*`. It has a file-level allowlist for
  the two remaining offenders, `gift-route-helpers.ts` and `public-gift-route-handler.ts`, each
  with a comment pointing to the Sprint 4 debt item.

## Risks / Trade-offs

- **[Risk]** The automatic claim surprises a signed-in creator who wanted to keep a draft
  anonymous. → Mitigation: a signed-in creator who opens a draft held by this browser is its
  creator. The aside already states that the draft is now protected by the account.
- **[Risk]** A timeout aborts a slow but successful save. → Mitigation: the save is retried with
  the same `expectedRevision`. If the first one had landed, the retry gets a `409` with
  `actualRevision`, and the creator resolves it explicitly. 15 s is far above the normal latency.
- **[Risk]** A timed-out publish actually succeeded. → Mitigation: the `Idempotency-Key` replay
  returns the same `201` on the next attempt.
- **[Risk]** Pruning `giftRevisions` removes history someone wanted. → Mitigation: nothing reads
  it today. Published content lives in the immutable publication, and 20 revisions cover about 30
  s of typing or many separate sessions.
- **[Risk]** `VERCEL` is unset on a future non-Vercel deployment behind a trusted proxy. →
  Mitigation: everything falls back to the bounded `unidentified` subject, which is documented as
  the off-Vercel behavior. A new host would add its own trusted header deliberately.
- **[Risk]** The route-group move changes which pages show the generic loading skeleton. →
  Mitigation: `/` keeps it. `/auth/sign-in`, `/studio/new` and the harness render quickly and had
  no dedicated skeleton requirement.

## Migration Plan

- No database migration. Existing `giftRevisions` are pruned lazily on the next save of each gift.
- Deploy through `dev → stg → main` as usual. Rollback is redeploying the previous build:
  - the pruned revisions do not come back, which is intended;
  - drafts claimed automatically stay claimed, which is valid state for the old build.

## Open Questions

- **Vietnamese copy.** The confirmation text, the `Sắp ra mắt` explanation, the theme names, the
  status labels and the recovery page text are reviewer-recommended choices. The PO confirms them
  in the copy glossary (Bucket B, P7). Changing them later changes strings only.
