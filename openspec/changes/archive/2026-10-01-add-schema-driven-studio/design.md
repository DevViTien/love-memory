# Design

## Context

See proposal.md for why this change exists. Today:

- `apps/web/src/app/studio/[publicId]/page.tsx` is a dynamic server page (`force-dynamic`, and the
  Studio layout calls `connection()` for its nonce CSP). It loads the draft through
  `giftService.getDraft`, resolves the manifest and passes `gift`, `manifest` and the audio track
  DTOs to `DraftEditor`. It also renders a hard-coded, non-interactive step bar
  (`Nội dung`, `Ảnh & âm thanh`, `Xem trước`, `Xuất bản`).
- `apps/web/src/modules/gifts/presentation/draft-editor.tsx` keeps `content`, `gift` and a message
  in `useState` and renders every field in one list. `save()` sends
  `PATCH /api/gifts/{publicId}` on button click, replaces the local content with the response
  content, and shows `Revision {n}`. A `409` only produces a "reload the page" message.
- `MediaImageListField` owns its upload state and reports `onChange(fieldId, value)` after every
  order or caption change, including once after mount when it recovers a different order. On
  unmount it aborts every in-flight upload.
- `gift-service.updateDraft` validates with `parseTemplateDraftPayload`. It maps Zod issues to
  `fieldErrors` keyed by `issue.path.join(".")`, with `content` for root issues such as
  undeclared keys. Unknown or withdrawn audio produces an entry keyed by the field id. A failed
  asset-reference check produces an entry for every image field in the save.
  `gift-route-helpers.ts` maps a revision conflict to `409 CONFLICT` with
  `details.actualRevision`/`expectedRevision`, and a non-editable version to `409 CONFLICT`
  without details.
- `createTemplateDraftPayloadSchema` derives each field schema with `createFieldValueSchema` and
  only makes it optional. Image lists therefore keep `.min(minItems)` in drafts: a
  `memory-box@1.1.0` draft with 1 of the 3 required photos cannot be saved at all.
- `PATCH /api/gifts/{publicId}` is limited by the `gift-update` scope: 60 requests per 60 seconds
  per subject (`mongo-gift-rate-limiter.ts`). A signed-in user's subject is shared by all of that
  user's tabs and drafts. An anonymous subject is also charged to a network guard at 5 times the
  limit.
- Every successful `PATCH` writes one `giftRevisions` snapshot in the same transaction, even when
  the content did not change.
- The coverage gate includes `apps/web/src/modules/**/presentation/**/*.ts` with per-file
  thresholds (lines 60, branches 50, functions 60), and excludes presentation `.tsx`.

Governing ADRs:

- ADR-0001 (modular monolith): the Studio stays in the `gifts` module's presentation layer and
  calls the existing routes. No application or domain code is needed for autosave.
- ADR-0005 (route CSP modes): `/studio/{publicId}` keeps its nonce CSP. This change adds no route,
  no inline script and no `eval`. Zustand does not use `eval`.
- ADR-0004 (immutable template artifacts): the reserved step ids and the relaxed draft rule are
  SDK contract changes. They do not touch any stored artifact or manifest; no seeded manifest uses
  `preview` or `publish` as a step id.

## Goals / Non-Goals

**Goals:**

- Put all save, retry and conflict logic in framework-free `.ts` modules that can be tested with
  fake timers and a fake `fetch`, so the logic is covered by the per-file coverage gate. The
  `.tsx` components stay thin bindings.
- Keep one source of truth for validation: the SDK schemas used by the server.
- Stay inside the existing API: no new route, DTO or error code.

**Non-Goals:**

- A generic form library or a field-renderer registry for future field types.
- Persisting unsaved content across page reloads (IndexedDB), and cross-tab coordination
  (`BroadcastChannel`).
- Server-side de-duplication of unchanged saves. The client never sends unchanged content, which
  is enough for the MVP.

## Decisions

### D1. File layout: pure modules plus thin components

New folder `apps/web/src/modules/gifts/presentation/studio/`:

| File                                                                                                          | Kind  | Responsibility                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `studio-steps.ts`                                                                                             | pure  | `resolveStudioSteps(manifest)`: template steps from `resolveTemplateSteps`, then `preview`/`publish`. `resolveStudioLocation(steps, manifest, { step, field })` returns `{ stepId, focusFieldId }` following the order in the `studio-editor` spec. `stepSearch(stepId)` builds `?step=`.                                                            |
| `draft-validation.ts`                                                                                         | pure  | `normalizeFieldValue(field, raw)` (whitespace-only text, cleared date/theme → removed). `validateDraftContent(manifest, content, selectableTrackIds)` → field errors keyed by field id. `stepCompletion(manifest, steps, content, errors)`. `mapServerFieldErrors(manifest, fieldErrors)` → `{ byField, general }`. `textCounter(value, maxLength)`. |
| `draft-editor-store.ts`                                                                                       | pure  | `createDraftEditorStore(initial)` built with `zustand/vanilla`. See D2.                                                                                                                                                                                                                                                                              |
| `save-draft-request.ts`                                                                                       | pure  | `saveDraft(publicId, content, expectedRevision, { fetch, keepalive })` and `loadDraft(publicId, { fetch })`. They classify every response into a `SaveOutcome` union with Zod contracts: `saved`, `conflict`, `invalid`, `rate-limited`, `offline`, `transient`, `gone`, `rejected`.                                                                 |
| `autosave-controller.ts`                                                                                      | pure  | `createAutosaveController({ store, saveDraft, loadDraft, timers, isOnline })`. See D3.                                                                                                                                                                                                                                                               |
| `studio-step-nav.tsx`, `studio-field.tsx`, `save-status-bar.tsx`, `conflict-banner.tsx`, `readiness-step.tsx` | React | Rendering only. They read the store with `useStore(store, selector)` and call controller methods.                                                                                                                                                                                                                                                    |

`draft-editor.tsx` keeps its name and `DraftEditor` export as the editor shell. It creates the
store and the controller once per mount, provides them through a React context, binds browser
events (`online`, `offline`, `beforeunload`, `visibilitychange`, unmount), and syncs the URL. The
page removes its static step bar and its "revision" explainer.

_Alternative rejected:_ putting the logic in React hooks inside `.tsx` files. It would be excluded
from coverage and could only be tested through rendering and timers, which is slow and brittle.

### D2. One Zustand store per editor instance

State: `content`, `lastSavedContent`, `revision`, `status`
(`saved | pending | saving | failed | offline`), `serverFieldErrors`, `generalError`,
`conflict: { actualRevision } | null`, `readOnly` (the draft is gone or non-editable),
`reloadError`, and `contentGeneration`. Derived values (client errors, the first invalid field,
completion per step, `isDirty`, `shouldWarnOnLeave`, and the displayed status message) are computed
by selectors from `draft-validation.ts`. They are memoized per `content` reference, so they are
never stored twice.

- `lastSavedContent` starts as the loaded content, and `revision` as the loaded revision. The
  loaded content is therefore "saved" even when it is invalid: `isDirty` is `false`, so
  `beforeunload` is not armed. The status selector still shows the invalid-content message rather
  than `Đã lưu`, because it gives client errors precedence (`studio-autosave` "Save status
  messages"). This separates "is there something to lose" (`isDirty`, in-flight, conflict) from
  "can this be saved" (client errors). That removes the contradiction of a status that is never
  `Đã lưu` and a warning that never goes away.
- `firstInvalidField` walks `resolveStudioSteps` order and each step's `fieldIds`, and returns
  `{ fieldId, label }`. The status bar renders `Chưa lưu được: {label} chưa hợp lệ` and a `Sửa`
  link. The link uses the same in-page navigation as a `?field=` deep link (D7): it pushes
  `?step=<id>` and then focuses `studio-field-{fieldId}`, without a page load.

- The store is created with `createStore` from `zustand/vanilla` inside the editor
  (`useState(() => createDraftEditorStore(...))`). It is never a module-level singleton, so two
  editors or two tests never share state. This follows tech-stack.md: no global unversioned draft
  store, and autosave carries the revision.
- The store is not persisted (no `persist` middleware, no `localStorage`), so gift text never
  reaches browser storage. This keeps the "never log or leak gift text" invariant simple.
- `contentGeneration` increases only when `Tải bản mới nhất` replaces the content. Image fields use
  it in their React `key`, so they mount again and seed from the new content. Other edits never
  remount them, so uploads keep running.
- Actions: `setFieldValue(fieldId, raw)` (normalizes and clears that field's server error),
  `beginSave()` (marks a request in flight), `applyOutcome(outcome, sentContent)`,
  `replaceFromServer(gift)`, `setOffline(boolean)`, `setStatus(status)` and
  `setReloadError(boolean)`. The state also carries `inFlight` and a fixed `context` (manifest,
  resolved steps, selectable track ids, `publicId`) that the selectors read.

_Alternative rejected:_ React Hook Form with a Zod resolver, which tech-stack.md lists. The Studio
never "submits" a form. It autosaves partial drafts and derives completion from a second
(full) schema, and the image field is not a controlled input. RHF would add a dependency and a
second state container next to the store. It can be revisited when a template needs dynamic field
arrays.

_Alternative rejected:_ plain `useReducer`. It works, but a store outside React lets the
autosave controller read and write state from timers and event handlers without stale closures,
and lets it be tested without rendering.

### D3. Autosave controller as an explicit state machine

The controller owns the timers and the single in-flight request:

- `notifyChange()` restarts a 1500 ms debounce timer and sets `status` to `pending`, unless the
  content equals `lastSavedContent`, in which case it sets `saved`.
- When the timer fires, `saveNow()` runs. `saveNow()` does nothing when the editor is `readOnly`,
  in conflict, or has client errors (the status selector then shows the invalid-content message). If a request is in flight it sets a
  `queued` flag. Otherwise it snapshots the content and sends it with the last known revision.
- When a request finishes, the controller applies the outcome (D4). If `queued` is set, or the
  content changed since the snapshot, and the outcome allows saving, it calls `saveNow()` again at
  once. This gives "latest wins": intermediate content is skipped, and the next request uses the
  new revision.
- Equality is structural (`isDeepEqual` on plain JSON values) between the on-screen content and
  `lastSavedContent`. `lastSavedContent` is the content that was **sent**, not the response
  content. The server returns trimmed text, and applying it while the creator is typing would
  delete a trailing space mid-word. The response content is applied only by
  `Tải bản mới nhất`.
- `flush(options?: { keepalive?: boolean }): Promise<FlushResult>` cancels the debounce, sends
  the latest content when it is dirty and allowed, and waits until no request is in flight and
  nothing is queued. It resolves to
  `{ kind: "saved"; revision } | { kind: "conflict"; actualRevision } | { kind: "invalid" } |
{ kind: "offline" } | { kind: "failed" }`. `invalid` covers both client-side errors and a `400`.
  `failed` covers transient, rejected and `gone` outcomes. Concurrent callers share one
  promise. `flush` never rejects. When any caller asks for `keepalive`, every request the running
  flush still sends (including a queued follow-up) uses it, so a later `visibilitychange` or
  `pagehide` flush is honored even while an earlier normal flush is running.
  - Dependent actions (`add-gift-preview`'s `Xem trước`, `add-temporary-gift-publish`'s
    `Xuất bản`) must call `await controller.flush()` and proceed only on `saved`, using its
    `revision` as `expectedRevision`. This is the `studio-autosave` requirement "Pending saves
    settled before dependent Studio actions".
  - The controller also exposes `getLastSavedRevision()` (the revision of the last successful
    save, or the loaded revision) for read-only uses such as analytics.
- The same `flush({ keepalive: true })` is called, without awaiting it, on `visibilitychange` →
  `hidden`, on `pagehide` and on unmount. `keepalive` is used only when the serialized body is under 60 KiB,
  because browsers cap `keepalive` bodies at 64 KiB.
- `handleOnline()` / `handleOffline()` come from `window` events. `isOnline()` reads
  `navigator.onLine`.
- `keepMine()` sends the content with `expectedRevision = conflict.actualRevision`.
  `reloadLatest()` calls `loadDraft` and then `replaceFromServer`.
- Timers are injected (`setTimeout`/`clearTimeout`/`now`), and tests use `vi.useFakeTimers()`.
  `start()` subscribes to content changes of the store; `dispose()` clears every timer,
  unsubscribes and ignores late responses, except those awaited by a flush that started before
  `dispose()`: on unmount the editor calls `flush({ keepalive: true })` and then `dispose()`, and
  that flush still applies the in-flight response and sends the edits typed meanwhile with the new
  revision (it starts no timers). A flush requested after `dispose()` resolves `failed`.
  `start()` may be called again after `dispose()`, because React Strict Mode runs the editor's
  mount effect twice. `saveNow()` is the `Lưu ngay` action.
- When a save sent by `flush()` fails, `flush()` resolves with that failure instead of sending
  again, and it never resends content the server already refused with `400` or another `4xx`.

### D4. Outcome handling and retry policy

| Outcome (from `save-draft-request.ts`)                                | Store effect                                                                                                                                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saved` (`200` + valid `GiftDraftResponseSchema`)                     | `revision = gift.revision`, `lastSavedContent = sent`, clear the retry count; the status becomes `saved` if the content is unchanged, otherwise the next save goes out |
| `conflict` (`409` with numeric `details.actualRevision`)              | `conflict = { actualRevision }`, cancel timers; no further saves                                                                                                       |
| `gone` (`404`, or `409` without `actualRevision`)                     | `readOnly = true`, show the non-editable alert, cancel timers                                                                                                          |
| `invalid` (`400` `VALIDATION_ERROR`)                                  | `mapServerFieldErrors` → `serverFieldErrors`/`generalError`, status `failed`, no retry                                                                                 |
| `offline` (fetch rejects while `navigator.onLine === false`)          | status `offline`; wait for `online`                                                                                                                                    |
| `transient` (fetch rejects while online, `5xx`, invalid success body) | status `failed`; retry after 2 s, 4 s, 8 s (3 retries), then stop                                                                                                      |
| `rate-limited` (`429`)                                                | as `transient`, with delay `max(backoff, retryAfterSeconds × 1000)`                                                                                                    |
| `rejected` (any other status, for example `403`/`415`)                | status `failed`, no retry                                                                                                                                              |

A change, `Lưu ngay` or `online` resets the retry count, but none of them ends a `429` window:
a save attempted inside it is scheduled for the end of the window. A late `invalid` response for content the
creator has since changed only affects fields that did not change, because `setFieldValue` clears
each changed field's server error. The image-field race is an example: the creator deletes an
image while a save that still references it is in flight, and the server answers `400` for that
field. The deletion is itself a change, so the next save sends the corrected list.

Nothing is logged. Errors carry no content, and the controller never calls `console`.

### D5. Validation reuses the SDK schemas; the draft schema stops enforcing `minItems`

- Client errors: `createTemplateDraftPayloadSchema(manifest).safeParse(content)`. Each issue is
  mapped to its first path segment. On top of that, an `audio` value outside the selectable track
  ids passed to the page is an error. Messages are Vietnamese and chosen by field type, never
  taken from Zod:
  - an unavailable track: `Bản nhạc này không còn khả dụng, hãy chọn lại.`;
  - an undeclared theme: `Giao diện này không còn khả dụng, hãy chọn lại.`;
  - an invalid date: `Ngày chưa hợp lệ.`;
  - over `maxItems`: `Tối đa {maxItems} ảnh.`;
  - anything else: `Nội dung này chưa hợp lệ, hãy kiểm tra lại.`
- Completion: `createTemplatePayloadSchema(manifest).safeParse(content)`. A step is complete when
  no issue's first segment is one of its fields and none of its fields has a client error.
- Both schemas are built once per manifest (memoized in the store factory), not on every
  keystroke.
- SDK change: `createTemplateDraftPayloadSchema` builds image-list schemas without `.min()`. The
  change goes through an explicit `draft` flag on `createFieldValueSchema`, and the full schema is
  unchanged. Without it, autosave would fail on the first photo of every field with
  `minItems > 1`. The server rule changes with it (`gift-drafts`), and full validation still
  enforces `minItems` where it matters: step completion, preview issues and publish. Existing
  stored drafts stay valid, because the rule only gets looser.
- Server `fieldErrors` keys are mapped by their first `.` segment. A key equal to a declared field
  id wins over the `content` fallback, so a template field named `content` still maps to itself.
- Whitespace-only text is removed from the content (`normalizeFieldValue`), so the most common
  invalid draft value can never be produced by the Studio. The text input keeps its own typed
  value while the stored value is empty and the typed value is whitespace-only, so a first space
  does not vanish from the screen; stored text always wins, and the input is reset when the stored
  draft replaces the content (`contentGeneration`). Only the content that is validated and sent is
  normalized; the server would trim the whitespace away anyway.
- Counters use `value.length`, the same UTF-16 unit that Zod `.max()` and the HTML `maxLength`
  attribute use, so the counter, the input limit and the server always agree.

### D6. Rate-limit compatibility

- One editor sends at most one request per debounce window plus its round-trip time, so steady
  typing produces at most about 40 `PATCH` requests per minute. Pauses shorter than 1500 ms send
  nothing. That is below `gift-update`'s 60 per 60 seconds.
- `Lưu ngay` is disabled while nothing is dirty and shares the single-flight queue. Image-field
  changes are ordinary content changes and share the same debounce.
- Two tabs of the same signed-in user share one subject and can exceed the limit when both are
  active. The `429` path waits for `retryAfterSeconds` (D4), and the second tab gets a revision
  conflict anyway.
- The limit is not changed, and `mutation-request-guards` is not modified. The `429`-then-save
  path has a unit test.

### D7. Steps, URL and focus

- The active step is derived from `useSearchParams()` (`next/navigation`). Step changes call
  `window.history.pushState(null, "", "?step=<id>")`. Next.js 16 syncs native `pushState` and
  `replaceState` with `useSearchParams` without a server round trip
  (`node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`,
  "window.history.pushState"). A step change therefore neither re-runs the dynamic server page
  nor re-reads the draft, and Back and Forward work. `router.push` was rejected because it
  re-renders the `force-dynamic` page and reads the draft from MongoDB on every step click.
- On mount, `resolveStudioLocation` handles `field` and then `step`. A resolved `field` triggers
  `replaceState` to `?step=<id>`, `scrollIntoView({ block: "center" })` (`behavior: "auto"` under
  `prefers-reduced-motion`), and `focus()` on the field's primary control.
- Every field's primary control has the id `studio-field-{fieldId}`: the text input, textarea,
  date input or select, and for image fields the file `<input>` inside the `Chọn ảnh` label.
  `MediaImageListField` gains an optional `inputId` prop for that, and an optional
  `errorMessageId` that marks the picker `aria-invalid` and references the field's inline error. Its visible labels (`Chọn ảnh`,
  `Chú thích ảnh {n}`) stay unchanged, because `add-local-object-storage`'s E2E selects them after
  opening `?field=memories`. The picker input is visually hidden (`sr-only`) but focusable, so
  focus lands on it and the label's focus ring shows.
- A step change after mount focuses the step `<h2 tabIndex={-1}>`. Focus is moved in an effect
  keyed on the step id, but only after a creator-initiated change, not on first render unless a
  deep link is present.
- All steps are rendered, and inactive ones get the `hidden` attribute. They are hidden, not
  unmounted, so `MediaImageListField` keeps its uploads, polling and recovery state
  (`studio-image-list-field`: "Upload continues on another step"). The DOM cost is small: at most
  8 steps and 40 fields.
- The navigation is a `<nav aria-label="Các bước tạo quà">` with an ordered list of buttons. The
  active one has `aria-current="step"`, and each accessible name includes `Đã xong`/`Còn thiếu`.
  The Studio steps have ids `preview` and `publish`. The SDK now rejects manifests that use
  them, so the ids cannot collide (`template-manifest-contract` "Studio steps").

### D8. Status, conflict and warning UI

- `save-status-bar.tsx` renders `<p role="status" aria-live="polite">` with the status text
  (`Đang lưu…` is used both while waiting for the debounce and while the request is in flight),
  plus the `Lưu ngay` button. It is sticky at the bottom on small screens, so it stays visible
  while typing.
- `conflict-banner.tsx` renders `role="alert"` with the two buttons. It does not steal focus from
  a field the creator is typing in. Screen readers announce the alert, and the buttons follow the
  banner text in tab order.
- `beforeunload` is registered only while `shouldWarnOnLeave` holds. That is `isDirty`, a request
  in flight, or an unresolved conflict. It never depends on client errors of the loaded content
  (D2). Browsers therefore keep the page eligible for the back/forward cache whenever nothing
  can be lost.
- `Tải bản mới nhất` asks for no extra confirmation. The label says what happens, and a
  confirmation would repeat the choice the creator just made.

### D9. Revision growth

Autosave replaces a few manual saves with one save per pause, so drafts collect more
`giftRevisions`. A 10-minute session typically produces 50–200 snapshots of a few KB each
(memory-box content is under 6 KB), which is at most about 1 MB per draft. Skipping unchanged
content removes the largest source of waste. Revision retention and pruning belong to Sprint 6
(Out of scope in tasks.md). The immutable history requirement is unchanged: snapshots are never
modified by this change.

## Risks / Trade-offs

- **Silent loss on in-app navigation.** `beforeunload` does not fire for client-side links such
  as `Đăng nhập để lưu lâu dài`. → `flush()` on unmount sends the pending change with
  `keepalive`. The E2E journey waits for `Đã lưu` before following that link.
- **A keepalive save lands after the page is gone.** If the creator comes back from the bfcache,
  the server revision is ahead and the next autosave conflicts. → The conflict banner handles it,
  and `Giữ bản của tôi` is safe because the content is the same.
- **Mobile Safari does not reliably fire `beforeunload`.** → The `visibilitychange` flush is the
  primary safety net on phones. The warning is best-effort.
- **A failed asset-reference check marks every image field in the save.** This is a server
  behavior (`gift-service.ts`). → Rare, because the Studio only sends assets the field created. The
  inline error disappears on the next change of that field. Narrowing the server's error to the
  offending field is not needed for Gate M2.
- **Relaxing `minItems` in drafts lets a draft be saved with too few photos.** → This is intended.
  Completion, preview issues and publish use the full schema, and a recipient never sees a draft.
- **Reserving `preview`/`publish` is a breaking SDK rule.** → No seeded or workspace manifest uses
  them. A manifest test covers every template workspace through the existing CI gate.
- **Merge order with other Sprint 3 changes.** `add-memory-box-template` may touch
  `template-manifest-contract` and `database-schema-management`. `add-gift-preview` and
  `add-temporary-gift-publish` will modify this change's "Studio preview and publish steps"
  requirement. They must also call `flush()` before acting (D3). `add-memory-box-template` also
  edits `packages/template-sdk/src/index.ts` and `apps/web/package.json`. → Keep this change's
  edits to those two files additive (new exports and one new dependency only), and re-diff the
  MODIFIED blocks before archiving (task 6.2).

## Migration Plan

1. The SDK change (draft `minItems`, reserved step ids) ships first. No stored manifest or draft
   becomes invalid.
2. No database migration. `DATABASE_SCHEMA_VERSION` is not changed by this change.
3. The Studio and the API ship in one Next.js deployment, so no deploy ordering applies. An old
   browser tab running the previous editor keeps working, because the API contract is unchanged.
4. Rollback is a revert of the deployment. Drafts saved with fewer images than `minItems` would
   then fail to save again in the old editor until the creator adds photos. They stay readable.
