# Design

## Context

See proposal.md for why this change exists. This design assumes that the five earlier Sprint 3
changes are archived and merged. Here is the state it builds on.

**HTTP guards** (`apps/web/src/http/api-response.ts`):

- `validateJsonMutationRequest(request, requestId)`:
  - it answers `415` unless the media type is exactly `application/json`;
  - it answers `403` for a `Sec-Fetch-Site` other than `same-origin`/`none`;
  - when an `Origin` header is present, it answers `403` unless `normalizeHttpOrigin(origin)`
    equals the effective request origin. `normalizeHttpOrigin("null")` returns `null`, so
    `Origin: null` is rejected. A request without `Origin` and without `Sec-Fetch-Site` passes.
- `readJsonBody(request, schema)` calls `request.json()` with no size limit. The error envelope
  codes are a closed set (`mutation-request-guards` "Standard API response envelope"). There is no
  `PAYLOAD_TOO_LARGE` code.

**Rate limiting** (`modules/gifts/infrastructure/mongo-gift-rate-limiter.ts`):

- `consumeApiRateLimit(scope, subject, secret)` (scopes `ApiRateLimitScope`) provides fixed
  windows, HMAC subject hashes and ×5 for shared buckets.
- After `add-temporary-gift-publish` it also exports `publicReadRateLimitSubject(request)`: IPv4,
  IPv6 `/64` or `unidentified`, never cookies. It adds the `public-gift-read` scopes, which pass
  `subject|share:{shareId}` as the counter subject.

**Database.** `packages/database/src/migrations.ts` holds the collection definitions, TTL indexes on
`expiresAt` with `expireAfterSeconds: 0`, validator and index drift detection, and the ledger.
After `add-temporary-gift-publish`, `DATABASE_SCHEMA_VERSION` is `8`.

**Studio** (after `add-schema-driven-studio`, `add-gift-preview` and `add-temporary-gift-publish`):

- `draft-editor-store.ts` is a Zustand vanilla store per editor. It has these parts:
  - `revision` and `lastSavedContent` change only on a successful save (`applyOutcome` `saved`) or
    on `replaceFromServer`, which also increments `contentGeneration`;
  - `selectStepCompletion` uses the full schema;
  - the store is never persisted.
- `autosave-controller.ts` provides `flush({ keepalive })`.
- `preview-action.ts` `requestPreview({ flush, fetch, publicId })` → `open | blocked |
rate-limited | gone | failed`. `readiness-step.tsx` calls `window.location.assign(url)` on
  `open`.
- `publish-action.ts` `requestPublish({ flush, fetch, publicId, idempotencyKey })` is called by
  `publish-step.tsx`.
- `giftService.getStudioGift({ publicId, accessors })` → `{ kind: "draft", draft }` or
  `{ kind: "published", publication }`. `app/studio/[publicId]/page.tsx` switches on it.

**Publish** (`add-temporary-gift-publish` D4, D6 and D14). `publishGift` maps the repository
outcomes `published | replayed | idempotency-conflict | stale | assets-changed`. D14 suggested
sending `gift_published` from the Studio. D8 below records it on the server instead.

**Viewer and public page** (`add-gift-preview` D5 and D10, `add-temporary-gift-publish` D8 and D9):

- `GiftViewer` accepts `onLifecycleEvent(event: ViewerLifecycleEvent)` with `opened`,
  `scene { sceneId }`, `completed` (once per play-through) and `fallback { reason }`. Payloads
  never carry content.
- `PublicGiftScreen` mounts it with a deferred source and no reporting handler.
- `PublicGiftService.isLiveShare(shareId)` (a boolean) is backed by a private `resolveLiveShare`
  that loads the gift, the publication and the manifest.
- `/g` and `/preview` send `Referrer-Policy: no-referrer` (a `next.config.ts` `headers()` entry).
- `PreviewScreen` passes no reporting handler.

**CSP.** `proxy.ts` does not process `/api/*`. Both the static app policy and the nonce policy
include `connect-src 'self'`, so a same-origin `fetch` to `/api/events` is allowed from every page
without a CSP change.

**E2E.**

- `playwright.config.ts` runs `next start` on port 3100 against an `_e2e` database, with
  `STORAGE_DRIVER=local` and `INTERNAL_PUBLISH_ENABLED=true`.
- The projects are `chromium`, `mobile-chromium` (Pixel 7) and `installed-chrome`. All three are
  Chromium, so CDP is available.
- `test:e2e` loads `.env` into the test process. Specs already use `MongoClient` for cleanup
  (`studio.spec.ts`).
- `apps/web/e2e/publish.spec.ts` holds the Gate M2 journey. Its sign-in and published-gift setup
  helpers are in `apps/web/e2e/support/` (`add-temporary-gift-publish` D14).
- `memory-box.spec.ts` shows the snapshot approach: screenshots attached with `testInfo.attach` and
  `animations: "disabled"`, plus DOM layout assertions, and no pixel baselines.

**Governing ADRs.**

- ADR-0001 (modular monolith): a new `modules/analytics`, wired only in `composition/`.
- ADR-0002 (native driver): an explicit collection, validator and TTL index.
- ADR-0005 (route CSP modes): no new page, no CSP change.
- tech-stack.md §17.2 names "PostHog or equivalent". It is not an ADR. This change records the
  first-party choice for the MVP in a new ADR-0010 (task 8.1).

No decision contradicts an accepted ADR.

## Goals / Non-Goals

**Goals:**

- An event can never carry gift content or an identifier that leads back to a person or a share
  link. The strict schema, the server-computed `giftRef` and the server-set timestamps enforce this
  by construction, not by convention.
- Analytics can never degrade the product. Sending is fire-and-forget, a disabled or misconfigured
  setup degrades to "no events", and `gift_published` is written after the response.
- The funnel joins across Studio, server and recipient through one pseudonym (`giftRef`).
- Logic lives in `.ts` files with unit tests (config, schemas, service, route handler, client,
  trackers). `.tsx` files only wire props.
- Gate M2 gets reproducible evidence: E2E assertions, attached snapshots, a recorded performance
  baseline and one results document.

**Non-Goals:**

- Querying, aggregating or displaying events.
- Batching several events per request. Volumes are small (D5), and one event per request keeps
  validation and rate limiting simple.
- Real-user performance monitoring (RUM). The Playwright baseline is a lab measurement.

## Decisions

### D1. Module layout

| Path                                                                   | Kind           | Responsibility                                                                                                                                                                     |
| ---------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/analytics.ts`                                  | schemas        | `ANALYTICS_EVENT_NAMES`, `CLIENT_ANALYTICS_EVENT_NAMES`, `GiftRefSchema`, `AnalyticsSceneIdSchema`, `AnalyticsEventRequestSchema`, `AnalyticsContextSchema` (D2).                  |
| `packages/database/src/*`                                              | schema         | `COLLECTIONS.analyticsEvents`, its definition, the scope enum and version `9` (D11).                                                                                               |
| `apps/web/src/config/analytics.ts`                                     | config         | `parseAnalyticsEnvironment`, `getAnalyticsEnvironment` (D7).                                                                                                                       |
| `apps/web/src/http/api-response.ts`                                    | http           | `readJsonBody(request, schema, { maxBytes })` with the `too-large` failure, and the `413` response (D4).                                                                           |
| `modules/analytics/application/analytics-event.ts`                     | pure           | `ANALYTICS_RETENTION_DAYS = 180`, `AnalyticsEventRecord`, `createAnalyticsEventRecord(...)`.                                                                                       |
| `modules/analytics/application/automated-traffic.ts`                   | pure           | `isAutomatedUserAgent(userAgent)` (D6).                                                                                                                                            |
| `modules/analytics/application/analytics-service.ts`                   | service        | `recordBrowserEvent(request, now)`, `recordGiftPublished(input, now)` and `contextForGift(gift)`, with the ports `AnalyticsEventRepository` and `GiftRefFactory`.                  |
| `modules/analytics/infrastructure/gift-ref.ts`                         | infrastructure | `createGiftRefFactory(secret)`, the HMAC (D7).                                                                                                                                     |
| `modules/analytics/infrastructure/mongo-analytics-event-repository.ts` | infrastructure | `insert(record)`.                                                                                                                                                                  |
| `modules/analytics/presentation/events-route-handler.ts`               | presentation   | The `POST` handler (D4). `app/api/events/route.ts` re-exports it.                                                                                                                  |
| `modules/analytics/presentation/analytics-client.ts`                   | pure (browser) | `createAnalyticsClient({ context, fetch, storage, navigator })` → `{ send, sendOnce }`, and the session id (D3).                                                                   |
| `modules/analytics/presentation/studio-funnel.ts`                      | pure (browser) | `trackStudioFunnel({ client, isComplete, isDirty, store })` (D9).                                                                                                                  |
| `modules/analytics/presentation/recipient-events.ts`                   | pure (browser) | `createRecipientEventReporter(client)` → `onLifecycleEvent` (D10).                                                                                                                 |
| `composition/analytics.ts`                                             | wiring         | The service, the repository, the gift ref factory, and the after-response publish recorder (D8).                                                                                   |
| `modules/gifts/application/gift-service.ts`                            | service        | `getStudioGift` adds `analytics` to the draft result. `publishGift` calls the `PublishAnalytics` port (D8).                                                                        |
| `modules/public-gifts/application/public-gift-service.ts`              | service        | `isLiveShare` becomes `resolvePublicGiftPage(shareId)` → `{ analytics } \| null` (D7).                                                                                             |
| Studio and `/g` wiring                                                 | wiring         | `preview-action.ts` and `publish-action.ts` take a `report` callback. `draft-editor.tsx`, `publish-step.tsx`, `public-gift-screen.tsx` and both pages pass the context and client. |

`modules/analytics` imports nothing from `modules/gifts` or `modules/public-gifts`. Those modules
depend on small ports they declare themselves (`AnalyticsContextFactory`, `PublishAnalytics`), and
`composition/` satisfies them from the analytics service.

### D2. Taxonomy, request contract and stored record

- `ANALYTICS_EVENT_NAMES` is the eight names. `CLIENT_ANALYTICS_EVENT_NAMES` is the same list
  without `gift_published`.
- `GiftRefSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)`. That is the unpadded base64url length
  of 32 bytes.
- `AnalyticsSceneIdSchema = SlugSchema` (1–80, kebab), from `@love-memory/shared`. The SDK's
  `SCENE` allows any 1–80 string, so the analytics schema is stricter on purpose: a scene id can
  never smuggle free text.
- `AnalyticsEventRequestSchema` is a strict object: `name` from the client enum, `sessionId`
  (`z.uuid()`), `giftRef`, `templateId` (`SlugSchema`), `templateVersion`
  (`SemanticVersionSchema.max(64)`) and optional `sceneId`. A `superRefine` requires `sceneId` if
  and only if `name === "scene_completed"`, with the issue path `sceneId`. The `fieldErrors` keys
  therefore follow the existing `readJsonBody` convention.
- `AnalyticsContextSchema = { giftRef, templateId, templateVersion }` is what pages pass to client
  components. The client validates the prop and sends nothing when it is invalid.
- The stored record is built only by `createAnalyticsEventRecord` from a validated request or from
  the server publish input:
  - `_id` is `randomUUID()`;
  - `occurredAt = now` (server time);
  - `expiresAt = now + 180 days`;
  - `sessionId` is `null` for `gift_published`;
  - `sceneId` is `null` unless the event is `scene_completed`.

  The record has no optional keys, so every document has the same shape and the validator can
  require every field.

_Alternative rejected:_ a free-form `properties` object with a denylist. A denylist fails open. An
exact key set fails closed, and `add-…` changes can extend it deliberately.

_Alternative rejected:_ accepting a client `occurredAt`. Client clocks are wrong often enough to
corrupt ordering. Events are sent immediately, so the receive time is accurate to within seconds.

### D3. Browser transport: `fetch` with `keepalive`, not `sendBeacon`

`analytics-client.ts` sends with the following call. `fetch` is injected, and the call is never
awaited by callers:

```ts
fetch("/api/events", {
  method: "POST",
  keepalive: true,
  credentials: "omit",
  cache: "no-store",
  referrerPolicy: "strict-origin",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(event),
}).catch(() => undefined);
```

- **Mode.** The default mode `cors` is kept on purpose. Under the Fetch standard's "append a request
  `Origin` header" algorithm, a non-GET request whose mode is not `cors` gets
  `Origin: null` when the referrer policy is `no-referrer`. `/g` and `/preview` set that policy
  (`add-gift-preview` D10). A same-origin request in `cors` mode carries the real origin, which
  passes `validateJsonMutationRequest`, and `Sec-Fetch-Site` is `same-origin`. `mode:
"same-origin"` would therefore fail on `/g`. A unit test pins the absence of `mode`, and the E2E
  asserts the `Origin` header on `/g` (task 9.2).
- **Referrer policy.** The request sets `referrerPolicy: "strict-origin"`, which overrides the
  page policy for this request only:
  - on `/g` and `/preview` (page policy `no-referrer`), the `Origin` algorithm no longer sees
    `no-referrer`, so the real origin is sent even if a browser applied the `null` substitution
    to `cors` requests too. This is a second safeguard next to the default mode;
  - on `/studio/{publicId}` (page policy `strict-origin-when-cross-origin`), the same-origin
    `Referer` would otherwise carry the full path with the `publicId`. With `strict-origin` it is
    only the origin.

  The unit test pins the value. Safari iOS and the Zalo in-app browser are checked manually on
  staging (results document), because Playwright runs Chromium only.

- **Why not `navigator.sendBeacon`:**
  - With a string or a `text/plain` blob, the beacon is a `no-cors` request. It sends `Origin: null`
    on a `no-referrer` page, and its media type fails the `415` check.
  - With an `application/json` blob, Chromium refuses a non-CORS-safelisted beacon type.
  - Accepting `text/plain` on `/api/events` would reopen the "simple request" cross-site path that
    the JSON media-type guard exists to close.

  `keepalive` gives the property a beacon was wanted for: the request outlives a navigation, as
  with `preview_started` before `window.location.assign`. Bodies are about 250 bytes, far below the
  64 KiB keepalive quota.

- **Credentials.** `omit` means no session or anonymous cookie is sent, so the server cannot link
  an event to an account even by accident. The rate limiter never uses cookies for this endpoint
  (D5).
- **Session id.** It is scoped per gift. It lives in
  `sessionStorage["lm:analytics:session:{giftRef}"]` and is created with `crypto.randomUUID()`
  when missing or malformed.
  - One tab that opens two gifts, for example two share links or a creator's two drafts, produces
    two unrelated session ids, so no session links gifts.
  - The key holds only the `giftRef`, never a `publicId` or `shareId`, so it is the same on the
    Studio and on `/g`. A creator who opens their own share link in the Studio tab gets the
    Studio's session id for that gift, which is acceptable (Risks).
  - Every storage access is inside `try/catch`, with an in-memory fallback per gift. The dedup
    keys `lm:analytics:once:{name}:{giftRef}` behave the same way.
    Neither holds gift content, and the Studio store remains never persisted.
- **Opt-out signals.** `navigator.globalPrivacyControl === true` or
  `navigator.doNotTrack === "1"` turns `send` into a no-op. The Playwright browsers set neither.
- **No context, no events.** `createAnalyticsClient({ context: null })` returns a no-op client. This
  is how "analytics disabled" reaches the browser.
- **Failure handling.** There is no retry, no queue and no UI. A thrown `fetch` (for example a
  `keepalive` quota error) is caught synchronously as well as asynchronously.

_Alternative rejected:_ sending events through a dedicated worker or batching queue. That is more
code for a few events per minute, and batching would lose the tail of a session on tab close.

### D4. `POST /api/events` route order and body cap

`events-route-handler.ts`:

1. `requestId(request)`;
2. `validateJsonMutationRequest` → `415`/`403`;
3. `getAnalyticsEnvironment().enabled === false` → `204`;
4. `isAutomatedUserAgent(request.headers.get("user-agent"))` → `204`;
5. `readJsonBody(request, AnalyticsEventRequestSchema, { maxBytes: 2048 })`:
   - a `Content-Length` above the cap → `too-large` without reading;
   - otherwise the body stream is read with a running byte count, aborting at 2049 bytes →
     `too-large`;
   - then `JSON.parse` → `invalid-json`, and the schema → `validation`.

   `too-large` → `413` `VALIDATION_ERROR` `Request body is too large.`; the other failures →
   `createInvalidBodyResponse` (`400`);

6. the rate limits (D5) → `429` with `Retry-After`;
7. `analyticsService.recordBrowserEvent(body, new Date())` → `204`;
8. a thrown error → `reportOperationalFailure("analytics_event_store", error, requestId)` → `500`
   (a failure of the rate-limit store is logged as `analytics_event_rate_limit` instead)
   `INTERNAL_ERROR`.

`204` is `new Response(null, { status: 204, headers: { "Cache-Control": "no-store",
"x-request-id": id } })`. `413` reuses the envelope. `VALIDATION_ERROR` is the closest existing
code, and adding a code would widen `ApiErrorCodeSchema` for one route.

The `maxBytes` option is additive. Existing callers are unchanged. The mutation guards spec does
not define a body cap for other routes, and this change does not add one.

Disabled and automated requests are answered after the media-type and origin checks. A
cross-site page therefore still gets `403`. Disabled or bot traffic costs no database round trip,
and invalid bodies cost none either (the parse happens before the rate limit). This reverses the
"rate limit before body parse" order of the gift mutation routes. That is acceptable here because
the body is capped at 2 KiB and parsing is cheap, and it lets the per-session counter use the
validated `sessionId`.

**Caching and CSP.** This is an API route: the proxy does not assign it a CSP. Baseline headers
still apply, and `no-store` is explicit. No page changes its cache mode. `/studio/[publicId]` and
`/g/[shareId]` are already `force-dynamic`.

### D5. Rate limits

- The scopes `analytics-event` (60 per 600 s) and `analytics-event-ip` (1200 per 600 s) are added
  to `ApiRateLimitScope` and `RATE_LIMITS`.
- `subject = publicReadRateLimitSubject(request)`. Two counters are charged:
  - `consume("analytics-event", subject + "|session:" + sessionId)`;
  - then, if allowed, `consume("analytics-event-ip", subject)`.

  `isSharedBucket` already recognizes `unidentified|…` subjects (added for `public-gift-read`'s
  `subject|share:…`), so it needs no change; `analyticsSessionSubject(network, sessionId)` builds
  the per-session subject. The route handler receives the network and session subject functions
  from `composition/analytics.ts`, so `modules/analytics` imports nothing from `modules/gifts`.
  For the analytics scopes, the ×5 multiplier applies only to `analytics-event-ip` (6000 for
  `unidentified`). `analytics-event` keeps 60, because its subject
  includes a session id and is therefore never shared by many clients. The multiplier choice is a
  per-scope flag next to `RATE_LIMITS`, so the existing scopes keep their behavior.

- **Sizing.**
  - One play-through of an 8-photo gift sends at most 1 + 11 + 1 = 13 events:
    `gift_open_interaction`, `scene_completed` for `opening`, `memory-1..8`, `letter` and
    `finale`, and `gift_completed`. One Studio session
    sends 2 once-only events plus one per preview or publish click.
  - 60 per session (one gift in one tab) per 10 minutes allows about four full plays, or a long
    editing session.
  - 1200 per network per 10 minutes allows about 85 full plays behind one carrier-grade NAT
    address. Beyond that, events are dropped. That is acceptable for best-effort analytics, and the
    risk is recorded.
- **Cost.** A counted event costs two counter upserts and one insert. The per-network cap bounds
  the write rate from one address to 2 per second on average.

_Alternative rejected:_ charging only the network subject. One misbehaving tab could then use the
whole budget of a shared address. The per-session counter cannot be bypassed cheaply, because
rotating `sessionId` still hits the network cap.

### D6. Automated traffic exclusion

`isAutomatedUserAgent` lower-cases the header and tests it against the fixed substrings of the
spec. A missing or empty header counts as automated.

- The list covers declared crawlers and link unfurlers (Facebook, WhatsApp, Skype and every
  `…bot`, such as Zalo's, Telegram's and Discord's), Lighthouse and common CLI clients.
- A plain substring match also catches a few real browsers whose user agent contains a listed
  substring, for example the phone brand `CUBOT`. Their events are dropped. This is accepted,
  because the loss is small and a stricter pattern would miss real bots.
- It deliberately omits `headless`. Playwright's default Chromium user agent contains
  `HeadlessChrome`, and headless browsing by real people is negligible.
- The main defense is structural: recipient events need the `Mở quà` gesture, and Studio events
  need a signed or anonymous editor session doing real saves.
- `navigator.webdriver` is not used, because it is `true` under Playwright, and the E2E must
  exercise the real path.

### D7. `giftRef`, configuration and page context

- `config/analytics.ts` parses `{ ANALYTICS_ENABLED, ANALYTICS_GIFT_REF_SECRET }` without throwing.
  - `enabled = ANALYTICS_ENABLED === "true" && secret.length >= 32`.
  - When the flag is `"true"` but the secret is unusable, a module-level flag makes
    `console.warn({ event: "analytics_misconfigured" })` run once per process. The value is never
    logged.
  - The configuration is read per request, like `technical-spikes.ts` and `internal-publish.ts`,
    so a wrong value never takes a page down.
  - Unlike those flags, Production is not forced off. Whether to enable it there is a runbook
    decision. The accepted default is off in Production (Migration Plan).
- `createGiftRefFactory(secret)` returns
  `(giftId) => createHmac("sha256", secret).update("lm-gift-ref:v1:" + giftId).digest("base64url")`,
  which always gives 43 characters. The `v1` prefix separates it from any other HMAC made with that
  secret. The secret is dedicated: it is not `BETTER_AUTH_SECRET` or `LOCAL_OBJECT_STORAGE_SECRET`,
  so rotating auth never re-keys analytics and the reverse.
- `analyticsService.contextForGift({ id, templateId, templateVersion })` returns
  `{ giftRef, templateId, templateVersion }`, or `null` when disabled.
- The Studio:
  - `getStudioGift` receives an `AnalyticsContextFactory` port and returns
    `{ kind: "draft", draft, analytics }`;
  - `app/studio/[publicId]/page.tsx` passes `analytics` to `DraftEditor`;
  - the published panel receives none.
- `/g`:
  - `resolvePublicGiftPage(shareId)` returns `{ analytics }` built from the publication's
    `templateId` and `templateVersion` and the gift id, or `null` for every not-found cause;
  - the page calls `notFound()` on `null`, exactly as `isLiveShare === false` did;
  - `PublicGiftScreen` receives `analytics` next to `shareId`;
  - the HTML still carries no gift content (`public-gift-viewer` "Envelope without content"), and
    the E2E keeps asserting it.
- **Rotation** (runbook, task 8.3):
  - generate 48 random bytes (base64url) per environment, never shared between environments;
  - rotate only on suspected exposure, because joins across the rotation are lost (spec). Events
    already stored stay valid until their TTL;
  - no key id is stored. If planned rotation is ever needed, a `giftRefKeyVersion` field is a later
    additive change.

_Alternative rejected:_ the browser sends `publicId` or `shareId`, and the server hashes it. That
would put the share bearer secret into more request bodies, and it costs a gift lookup per event.

_Alternative rejected:_ hashing `publicId` instead of the internal id. The privacy is equivalent,
but the brief binds the internal id, which never leaves the server. That gives one more layer.

### D8. `gift_published` on the server, after the response

- `gift-service.ts` declares
  `PublishAnalytics { giftPublished(input: { giftId, templateId, templateVersion, requestId }): void }`.
  `publishGift` calls it exactly once, when the repository outcome is `published` (D6 of
  `add-temporary-gift-publish`). It never calls it on `replayed`, on any failure or on a thrown
  error. The call is synchronous and returns nothing, so the service cannot wait on it, and the
  service wraps it in `try/catch`, so even a port that throws synchronously never changes the
  `201`. `publishGift` takes an optional `requestId`, which the route handler passes, only to
  correlate a failed after-response write in the log.
- `composition/analytics.ts` implements it with `after()` from `next/server`, which is allowed in
  Route Handlers (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`). The
  callback runs `analyticsService.recordGiftPublished(...)` inside `try/catch`, reporting
  `reportOperationalFailure("analytics_gift_published", error, requestId)`. When analytics is
  disabled, it does nothing.
  - `after` runs even when the response failed, but the port is only called on success, so that
    does not matter.
  - When `after` throws because there is no request scope (a script or a test using the real
    composition), the implementation catches it and starts the write as a detached promise with
    the same `catch`.
- This departs from `add-temporary-gift-publish` D14, which suggested a Studio-side event. The
  server is authoritative:
  - replays and second tabs cannot double count;
  - a closed tab cannot lose the event;
  - a browser cannot forge it, because `/api/events` rejects `gift_published`.

_Alternative rejected:_ an outbox job. The outbox invariant covers business work that must happen
and be retried. An analytics row is best-effort by definition, and an outbox row per publish would
add a job type, a worker path and retries for data that the spec explicitly allows to lose.

_Alternative rejected:_ writing inside the publish transaction. That adds latency and a failure
mode to the publish, and couples the analytics collection's availability to publishing.

### D9. Studio hooks

- `trackStudioFunnel({ client, isComplete, isDirty, store })` subscribes to the editor store and
  returns the unsubscribe function. `DraftEditor` calls it in an effect and cleans it up on
  unmount, passing the store selectors `selectTemplateStepsComplete` (new, next to
  `selectStepCompletion`) and `selectIsDirty`, so `modules/analytics` does not import the Studio.
  - `customization_started`: when `revision` increases while `contentGeneration` is unchanged.
    This is a successful save of a creator edit. `replaceFromServer`, the conflict reload, bumps
    `contentGeneration` and never counts. Sent with `sendOnce`.
  - `required_content_completed`: `sawIncomplete` starts from the initial state. On every state
    change, the tracker recomputes whether all template steps are complete (`selectStepCompletion`
    over the template step ids, excluding the `preview` and `publish` Studio steps).
    - Incomplete → set `sawIncomplete`.
    - Complete on a real save transition (`revision` increased with an unchanged
      `contentGeneration`), not dirty, and `sawIncomplete` → `sendOnce`. `status === "saved"`
      alone is not enough: the autosave controller also sets it when an edit is undone back to the
      saved value, and `replaceFromServer` sets it on a conflict reload, with no save at all.

    "Complete" therefore means that the saved content, which equals the content on screen,
    satisfies the full schema.

  - Loading, step navigation and failed saves change neither `revision` nor the completion of the
    saved content, so they emit nothing.
- `requestPreview({ ..., report })` calls `report("preview_started")` just before returning
  `open`. `readiness-step.tsx` then calls `window.location.assign`, and `keepalive` carries the
  request.
- `requestPublish({ ..., report })` calls `report("publish_clicked")` first, before `flush()`.
  `publish-step.tsx` calls it only from the enabled, non-busy button, so disabled and double clicks
  never report.
- `report` defaults to a no-op, so existing tests of both actions keep passing unchanged.
- `DraftEditor` creates the client with `useMemo(() => createAnalyticsClient({ context: analytics,
... }), [analytics])`.

### D10. Recipient hooks

`createRecipientEventReporter(client)` returns `onLifecycleEvent`. It is a small state machine
whose state is `opened`, `currentScene`, the set of sent scene ids, `ended` and `completedSent`:

| Notification   | Action                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opened`       | send `gift_open_interaction` once                                                                                                                   |
| `scene { id }` | ignored if `ended`. If `currentScene` is set and not yet sent, send `scene_completed(currentScene)`. Then `currentScene = id` if it is a valid slug |
| `completed`    | ignored if `ended`. Send `scene_completed(currentScene)` if not yet sent, then `gift_completed` once, then `ended = true`                           |
| `fallback`     | `ended = true`, and send nothing                                                                                                                    |

- `scene` and `completed` before `opened` are ignored: nothing counts before the content was
  delivered after `Mở quà`.
- `PublicGiftScreen` creates the reporter with `useMemo` keyed on the context's values
  (`giftRef`, `templateId`, `templateVersion`), not the prop object, so a re-render with an equal
  context never resets it (`DraftEditor` keys its client the same way), and passes its
  `onLifecycleEvent` to `GiftViewer`. The gift viewer is unchanged.
- `PreviewScreen` and the Viewer harness (`ViewerShell`) are untouched. Regression tests assert that
  they make no `/api/events` request (task 7.3).

### D11. Database schema version 9

- `COLLECTIONS.analyticsEvents = "analyticsEvents"` is appended in code. The spec lists it
  alphabetically.
- The validator requires `_id` (string, `minLength` 1), `name` (enum of the eight), `giftRef`
  (pattern `^[A-Za-z0-9_-]{43}$`), `templateId` and `templateVersion` (strings, `minLength` 1),
  `sessionId` and `sceneId` (`bsonType: ["string", "null"]`), `occurredAt` and `expiresAt`
  (date). `additionalProperties` stays allowed, following the project convention. Strictness lives
  in Zod (D2).
- Indexes:
  - `analytics_events_expiry_ttl` on `{ expiresAt: 1 }`, with `expireAfterSeconds: 0`;
  - `analytics_events_name_occurred` on `{ name: 1, occurredAt: 1 }`, for time-bounded counts per
    step, the only query shape the Non-goals leave for ad-hoc analysis.

  There is no `giftRef` index: per-gift joins are occasional, and the collection is bounded by the
  TTL.

- The `apiRateLimits` scope enum gains `analytics-event` and `analytics-event-ip`.
- `DATABASE_SCHEMA_VERSION = 9`.
- `migrations.test.ts` asserts:
  - the definitions;
  - that drift in the new validator and TTL index is detected;
  - that simulated version-`6`, `7` and `8` databases each reach `9` in one run.
- **Volume.** An event document is about 300 bytes. At 1 000 published gifts a day with about 20
  events each, 180 days hold about 3.6 M documents, around 1–1.5 GB with indexes. That is
  acceptable for the MVP cluster, and it is the trigger for the warehouse export named in ADR-0010.

### D12. Gate M2 verification deliverables

**Funnel assertions** in the existing `publish.spec.ts` journey, without a second journey:

- A `support/analytics.ts` helper records every `POST /api/events` of a page: the parsed body, the
  `Origin` header and the response status.
- A `readAnalyticsEvents(giftRef)` helper reads `analyticsEvents` through `MongoClient`, polling up
  to 10 s, and deletes the events in `afterAll`.
- Assertions:
  - Creator page: `customization_started`, `required_content_completed`, `preview_started` and
    `publish_clicked`, each exactly once. All carry one `giftRef`, `memory-box` and `1.1.0`, and
    all are answered `204`. No recipient event name appears in the creator context, which includes
    the preview page, played to its end.
  - The replayed publish (journey step 6) leaves exactly one `gift_published` in the database, with
    `sessionId: null`.
  - Anonymous context:
    - no event before `Mở quà`;
    - then `gift_open_interaction`, `scene_completed` for `opening`, `memory-1..3`, `letter` and
      `finale`, and `gift_completed`, each once;
    - the `Origin` header equals the base URL;
    - its `sessionId` differs from every creator `sessionId`.
  - The fallback context (artifacts aborted) sends `gift_open_interaction` and nothing after it.
  - Database privacy: every stored document has exactly the nine keys of D2, and
    `expiresAt - occurredAt` is 180 days. No serialized document contains the `publicId`, the
    `shareId`, `receiver-name`, any caption, the letter or an asset id.

**Visual snapshots** (both `chromium` and `mobile-chromium`), attached through the existing
`captureViewerScreenshot` pattern. Scenes: the `/g` envelope, `opening`, `memory-1`, a memory card
with a missing caption, `letter`, `finale`, and the static fallback.

- To freeze a scene without host controls, the test hides the page. It overrides both
  `document.hidden` (`true`) and `document.visibilityState` (`hidden`) on the host document, and
  dispatches `visibilitychange`. The host then sends `PAUSE`, and the test waits for the frame
  `body`'s `data-paused` attribute before capturing. It captures, restores visibility and
  chooses `Tiếp tục`. This also exercises the `gift-viewer` pause and resume path on the public
  page.
- The host's pause overlay (`Tiếp tục`) would dim the capture, so the test hides that overlay
  element for the screenshot only (through an element handle) and restores it before resuming.
- `finale` is captured once the template reports `COMPLETE` (`body[data-state="complete"]`),
  without a pause: the finale completes on its own after 1.2 s, and the host does not pause a
  completed gift. Nothing changes after `COMPLETE`, so the capture is stable.
- Layout assertions per scene:
  - no horizontal overflow in the host or the frame;
  - `Tiếp` inside the frame viewport;
  - `Mở quà` and `Tiếp tục` at least 44 × 44 px;
  - the fallback region `Nội dung món quà` scrollable, with its last block reachable.

  There are no pixel baselines, as in `add-memory-box-template`.

**Funnel through the end.** Journey step 9 of `add-temporary-gift-publish` stops at `memory-1`.
This change extends it: the test presses `Tiếp` through every memory card and `letter` until the
template reports `COMPLETE`. The memory-box runtime sends `SCENE finale` before `COMPLETE`, so the
expected `scene_completed` ids are `opening`, `memory-1..3`, `letter` and `finale`.

**Edge-case content set**, a second parameterized run of the same journey steps. Each run signs in
with an e-mail that is unique per Playwright project and content parameter, for example
`publish-${project}-${parameter}-${Date.now()}@example.test`, so parallel runs never share an
account or a captured magic link:

| Field              | Value                                                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `receiver-name`    | Vietnamese with diacritics plus the emoji `👩‍❤️‍👨`, padded to exactly the Studio counter maximum (`40/40`)                                                                              |
| `anniversary-date` | `2024-02-29`, shown as `29/02/2024` in the fallback                                                                                                                                 |
| `opening-message`  | 120 characters including `<b>không đậm</b> & "trích dẫn"`                                                                                                                           |
| `memories`         | 8 photos (the committed fixtures, reused; `photo.jpg` is the 320×240 landscape one). Captions: one at exactly 140 characters, one empty, one emoji-only (`🌲🇻🇳👍🏽`), one markup-like |
| `final-letter`     | 1200 characters: four paragraphs separated by blank lines, one unbroken 90-character token, and NFD-decomposed `Tiếng Việt`                                                         |

- The Studio must accept each value at its maximum and show `n/n`.
- Preview and `/g` must show identical text for every scene. The test collects the in-frame text
  per `section[data-scene]` in both and compares the arrays. This is "Content preview và published
  giống nhau".
- No `b` element may exist in the frame, and nothing may overflow horizontally.
- The fallback run must show every value, including `29/02/2024`.

**Performance baseline** in a new `apps/web/e2e/gift-performance.spec.ts`:

- It runs from its own command only, so parallel workers and other specs never disturb the
  numbers:
  - its tests are tagged `@perf`;
  - `test:e2e` and `test:e2e:chrome` add `--grep-invert @perf`, so `verify:local` does not run it;
  - a new root script `test:e2e:perf` runs `--grep @perf --project=mobile-chromium --workers=1`,
    with the same `.env` loading as `test:e2e`. The results document records this command and the
    machine it ran on (CPU, RAM, OS, Node and Chromium versions).
- It publishes one typical gift once with the `support/` setup helper, and deletes that gift's
  analytics events in `afterAll`.
- It does three cold runs per profile. Each run uses a new browser context with the
  `mobile-chromium` device options, so the HTTP cache is empty, and blocks service workers.
- Profiles, both in the single project:
  - `unthrottled`;
  - `slow-4g`: CDP `Network.emulateNetworkConditions` (150 ms latency, 1.6 Mbit/s down,
    750 kbit/s up) and `Emulation.setCPUThrottlingRate` 4.
- Metrics:
  - host navigation TTFB as the wall-clock time until the document commits (Chromium's CDP
    latency emulation does not show in `PerformanceNavigationTiming.responseStart`), and
    `domContentLoaded` from `PerformanceNavigationTiming`, converted to wall-clock time from the
    start of the navigation through `performance.timeOrigin`;
  - the envelope LCP from a buffered `largest-contentful-paint` observer, with its element tag,
    converted the same way;
  - the request count and encoded bytes by resource type before the tap, from `request.sizes()`;
  - after the tap, relative to the click:
    - the `/api/public-gifts` response end;
    - the time until the `opening` scene is visible in the frame;
    - the response end of the first image request after the tap, from Playwright's network events
      (the wall-clock time of `requestfinished`; `request.timing()` hides the emulated latency
      too), not from the image element. The run waits until every photo of the gift has loaded;
  - the encoded bytes of the artifact (HTML, JS, CSS), the payload, the images and the audio;
  - the medians of the three runs.
- Output: `performance-baseline.json` plus a Markdown table, written with `testInfo.outputPath` and
  attached. They are not committed. Task 9.6 copies the values into the results document.
- Assertions, none of them timing-based:
  - the artifact JS, gzip-compressed in the test with `zlib.gzipSync` from the response body so
    that the result does not depend on server compression, is at most 60 KiB;
  - no image, audio or `/api/public-gifts/` request happens before the tap (plan.md §21.1);
  - no request goes to an origin other than the app.

**Results document** `docs/sprints/sprint-3-results.md`, following `sprint-1-results.md`:

- Delivered, per change;
- Automated verification:
  - the `verify:local` run with date and the tested commit SHA;
  - the E2E specs per project;
  - the baseline tables per profile, with the `test:e2e:perf` command and the machine;
  - the template budget from `build-metrics.json`;
  - the funnel check;
- a Gate M2 checklist mapping each exit criterion (plan.md §12.6–12.7) to its evidence, or to
  `Pending (manual)` with an owner field:
  - the staging demo by a non-technical person;
  - an anonymous open on another device;
  - Safari iOS and Chrome Android exploratory checks per `docs/quality/browser-support.md` and
    `mobile-audio-checklist.md`;
  - real performance on staging;
  - the staging demo gift has the full event chain in `analyticsEvents`, from
    `customization_started` to `gift_completed`, under one `giftRef`;
  - events are stored from Safari iOS and from the Zalo in-app browser, which checks the `Origin`
    and `referrerPolicy` behavior outside Chromium;
  - after sharing the link in Zalo and in Messenger, the link unfurler's fetch stored no event (the
    open question on unfurler user agents);
  - at least one licensed audio track (Product Owner dependency);
- Known issues, with severity per plan.md §19.4.

### D13. MODIFIED requirement provenance (re-diff before apply)

| Capability                   | Requirement                                                                                                       | Based on                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database-schema-management` | Collection registry; JSON-schema validators; Named indexes; Idempotent migration with ledger; Schema verification | `add-temporary-gift-publish` delta (version 8), which builds on the `add-gift-preview` delta (version 7)                                                                        |
| `database-schema-management` | Gift persistence verification                                                                                     | `add-temporary-gift-publish` delta; the only edit rewords its scenario "with the version `8` schema" to "with the current schema", so it does not go stale at each version bump |

"Database seed" is not modified. The seed changes of `add-memory-box-template` are therefore
unaffected.

Task 1.1 re-diffs each block against `openspec/specs/` once `add-temporary-gift-publish` is
archived.

- **Expected differences.** None, apart from this change's additions:
  - `analyticsEvents` in the registry, the validators and the indexes;
  - the two scopes;
  - version `9` and its scenarios;
  - "current schema" instead of "version `8` schema" in "Gift persistence verification".
- **Waiver** (owner `DevViTien`). `database-schema-management` / "Schema verification" for change
  `add-funnel-analytics` is needed **now**. The block replaces the backticked message
  `MongoDB schema version mismatch: expected 6, received 1.` (today's main spec), and after the
  earlier archives `… expected 8, received 1.`, with the version-9 message. One entry covers both
  periods. The coordinator records it in `openspec/gate-exceptions.json`, and task 10.3 removes it.
  Until it exists, `check-openspec.ts` fails with exactly that one error.
- The other five blocks keep every backticked identifier of both the current main spec and the
  version-8 delta, so they need no waiver. "Gift persistence verification" does not exist in its
  version-8 form until `add-temporary-gift-publish` is archived; the re-diff in task 1.1 confirms
  that the main spec then equals the copied text apart from the one reworded scenario.

### D14. Tests

- **Unit** (Vitest, next to the code):
  - contracts `analytics.test.ts`: each name, `gift_published` refused, extra keys, the `sceneId`
    rules, the formats;
  - `config/analytics.test.ts`: `true` with a good or short secret, `false`, absent, `TRUE`, the
    warning printed once and never with the value;
  - `http/api-response.test.ts`: the cap by `Content-Length` and by stream, and cap + 1 byte;
  - `automated-traffic.test.ts`;
  - `gift-ref.test.ts`: a known vector, 43 characters, stability, different secrets giving
    different refs;
  - `analytics-event.test.ts` and `analytics-service.test.ts`: the record shape, `null` fields and
    the 180-day expiry;
  - `mongo-analytics-event-repository.test.ts`;
  - `events-route-handler.test.ts`: every `funnel-analytics` endpoint scenario, the check order,
    uncharged counters on `400`/`413`/`403`, bot and disabled `204`s, `500` and its log line;
  - `mongo-gift-rate-limiter.test.ts`: both scopes and the ×5 rule;
  - `analytics-client.test.ts`: request init (no `mode`, `keepalive`, `credentials: "omit"`,
    `referrerPolicy: "strict-origin"`), the per-gift session key,
    fire-and-forget on rejection or throw, the session id in storage, in memory and malformed,
    `sendOnce`, GPC and DNT, the no-op client;
  - `studio-funnel.test.ts` with the real store;
  - `recipient-events.test.ts`: every table row and spec scenario;
  - `preview-action.test.ts` and `publish-action.test.ts`: the `report` calls;
  - `gift-service.test.ts`: `getStudioGift` analytics, and `giftPublished` only on `published`;
  - `public-gift-service.test.ts`: `resolvePublicGiftPage`;
  - `composition/analytics.test.ts`: the `after` fallback;
  - `migrations.test.ts` and `collections.test.ts`.
- **Component** (no jest-dom matchers):
  - `public-gift-screen.test.tsx`: the reporter is wired, and nothing is sent before the tap;
  - `preview-screen.test.tsx` and the harness test: no `/api/events` request;
  - `draft-editor.test.tsx`: the tracker is subscribed and disposed.
- **Real MongoDB:** `db:migrate` from `8` (and from `6`), then `db:verify`.
- **E2E:** D12, run by the coordinator after merging, never inside a worktree.

## Risks / Trade-offs

- **[Risk] Forged events pollute counts.** Anyone can post well-formed events with made-up
  `giftRef`s. → The damage is limited to analytics numbers. Rate limits bound the volume per
  address. `gift_published`, the most decision-relevant step, cannot be forged. Analyses count
  distinct `giftRef`s that also have a server `gift_published` event, where relevant.
- **[Risk] Carrier-grade NAT undercounts recipients.** → The per-network cap of 1200 per 10
  minutes is generous (D5). Drops are silent and only affect analytics. If staging shows 429s from
  `/api/events`, the cap is a constant to raise.
- **[Risk] A `giftRef` in page HTML and requests is a stable pseudonym.** → It reveals nothing
  without the secret, it is only given to pages that already passed their access check, and it is
  not linked to accounts (no credentials, no user id). The analytics collection and the gifts
  collection live in the same database, so an operator with database access could join them
  through the secret. The same operator can already read gift content, so this adds no exposure.
- **[Risk] Analytics volume in the operational cluster** (tech-stack.md §17.2 warns against it
  long-term). → The 180-day TTL, small documents and the D11 estimate. ADR-0010 names the
  threshold and the export path.
- **[Risk] Bot heuristics miss unknown crawlers.** → Recipient events need a real tap, so
  unknown crawlers produce no recipient events. Studio events need real saves. The list is a
  constant and cheap to extend.
- **[Trade-off] Owners count as recipients.** A creator who opens their own `/g/{shareId}` link,
  for example to check it before sharing, sends recipient events like anyone else. → The page
  cannot tell them apart without identifying the viewer, which the privacy rules forbid.
  ADR-0010 and `docs/architecture.md` state this, and analyses read open and completion counts as
  upper bounds.
- **[Trade-off] No event on Viewer fallback.** Recipients who see the static rendering never send
  `gift_completed`, so completion is understated when a template breaks. → Fallback rates belong
  to technical observability (Sentry, Sprint 7). The results document records fallbacks seen in
  testing.
- **[Trade-off] Lab performance numbers.** CDP throttling on a desktop CPU does not equal a
  mid-range Android device. → The baseline is labelled "lab". Real-device measurement on staging
  is a pending manual Gate M2 check in the results document.
- **[Risk] Snapshot flakiness.** Automatic scene timers could move a scene during capture. → The
  visibility-pause technique freezes the template (D12), and the test asserts the scene before and
  after each capture. The performance spec asserts no timing.
- **[Risk] Merge order.** This change edits files that the earlier changes created or changed:
  `gift-service.ts`, `public-gift-service.ts`, `preview-action.ts`, `publish-action.ts`,
  `publish-step.tsx`, `public-gift-screen.tsx`, both pages, `mongo-gift-rate-limiter.ts`,
  `migrations.ts` (version `8` → `9`), `playwright.config.ts` and `publish.spec.ts`. → All edits
  are additive. Apply starts only after all five earlier changes are merged (task 1.1).

## Migration Plan

1. Deploy runs `pnpm db:migrate`. From version `8`, it creates `analyticsEvents` with its validator
   and both indexes, replaces the `apiRateLimits` validator and records version `9`. From `6` or
   `7`, the same run also applies the earlier steps. This is purely additive.
2. Set the variables per environment (runbook, task 8.3):
   - `dev` and `stg`: `ANALYTICS_ENABLED=true` and a distinct `ANALYTICS_GIFT_REF_SECRET` each;
   - Production: `ANALYTICS_ENABLED` absent (off), with its own secret provisioned, until the
     Product Owner confirms. This default is an accepted product decision. The stored data is
     pseudonymous, but Production waits for the privacy notice and consent copy of Sprint 6
     (plan.md §20.3). Turning it on later changes one environment variable, not the code.

   Ship the code in the same deployment. Without the variables, the code runs with analytics off.

3. **Rollback:** redeploy the previous build.
   - The old code ignores `analyticsEvents`, and the analytics counters expire by TTL.
   - The old `db:verify` reports drift: the `apiRateLimits` validator and ledger version `9`.
     Running the old `db:migrate` restores the version-8 validator and ledger.
   - The leftover `analyticsEvents` collection is not managed by version 8. Its documents keep
     expiring through the TTL index that was already created.
   - No gift, publication or asset document is touched in either direction.

   `docs/architecture.md` records this note.

## Open Questions

- **Unfurler user agents seen in Vietnam.** The exact user agents of Zalo and Messenger link
  previews are not verified yet. The `bot` and `facebookexternalhit` substrings are expected to
  cover them. The staging exploratory session in the results document checks one shared link per
  app, and any addition is a constant change.
