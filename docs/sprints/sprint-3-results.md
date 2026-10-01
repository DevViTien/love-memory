# Sprint 3 — Vertical slice with Template 1 "Hộp ký ức"

Date: 2026-10-01
Branch: `feat/sprint-3`

Gate M2 status: **automated evidence passed; manual checks pending.** The checklist below maps each
exit criterion of plan.md §12.6–12.7 to its evidence. Template 2–3 work starts only after the
pending manual checks pass (plan.md §12.7).

The BA, DEV and QA reviews of this sprint, the disposition of every finding, the Product Owner
decisions, the staging charter and the Sprint 4 debt are in
[sprint-3-review.md](./sprint-3-review.md).

## Delivered

Ten OpenSpec changes were archived on 2026-10-01. The sprint was prepared by
`change-template-contract-for-studio` (the manifest contract the Studio needs) and the baseline
fixes `fix-baseline-review-findings` and `fix-media-persistence-and-guards`. The six Sprint 3
stories followed, in this order:

1. `add-memory-box-template`: Template 1 "Hộp ký ức" as `memory-box@1.1.0` (cover and host-owned
   tap to open, opening, 3–8 captioned memory cards, letter, finale, theme variants, reduced
   motion, the `ISSUE` message, and a static in-frame fallback). The seeded catalog points at
   `1.1.0`; `1.0.0` stays stored as `retired`.
2. `add-schema-driven-studio`: step-based Studio from the manifest, client validation with counters
   and field errors, a Zustand store, 1.5 s debounced autosave with offline and failure states, the
   unsaved-changes warning and explicit two-tab conflict resolution.
3. `add-local-object-storage`: a filesystem object storage adapter for development and Playwright,
   refused on every Vercel deployment.
4. `add-gift-preview`: the shared `buildViewerPayload`, 30-minute hashed preview tokens, the
   `/preview/{token}` page with viewport, restart, mute and reduced-motion controls, the issues panel
   with `Sửa` links, and the reusable `GiftViewer` with its static fallback.
5. `add-temporary-gift-publish`: internal free publish behind `INTERNAL_PUBLISH_ENABLED`, one
   idempotent transaction writing the immutable `giftPublications` snapshot pinned to the exact
   template version and artifact hash, the `/g/{shareId}` envelope and payload endpoint, and the
   Studio "Đã xuất bản" panel.
6. `add-funnel-analytics`: first-party, privacy-safe funnel events (`POST /api/events`,
   `analyticsEvents` with a 180-day TTL, the `giftRef` HMAC, schema version 9), plus the Gate M2
   verification below ([ADR-0010](../adr/0010-first-party-funnel-analytics.md)).

The review findings were then fixed by `fix-sprint-3-review-findings`, archived last. It covers:

- templates without an artifact shown as `Sắp ra mắt`;
- an automatic claim on return from sign-in;
- the publish confirmation and the read-only editor while publishing;
- request timeouts and interrupted-upload cleanup;
- bounded `giftRevisions`;
- rate-limiter and logging fixes;
- gift viewer edge states and focus;
- a real `404` for unknown `/g` and `/preview` links.

## Automated verification

### Full local gate

The evidence was re-run at the final code HEAD (QA-D-9). `pnpm verify:local` passed on 2026-10-01
at commit `65e3912266ef12f2549b355c6ba7a8d7f5b9dea5`. It ran the secret scan, `spec:check`, format,
lint, types, coverage with the per-file gates, the audit, the production build and the
installed-Chrome E2E. The commits after it change only this document and the OpenSpec archive.

- Unit and component tests (Vitest): 146 files, 1417 tests passed.
- Coverage: statements 95.94 %, branches 91.95 %, functions 96.66 %, lines 96.94 %. Every `.ts`
  file meets the per-file thresholds.
- `pnpm audit`: no known vulnerabilities.
- `pnpm db:verify-gifts` passed against the local replica set. It now also isolates the publish
  revision compare-and-set on a draft that differs only by its revision.
- No migration or validator changed after schema version 9, so `db:migrate` was not re-run.

### End-to-end (Playwright, production build)

| Command                | Projects                                                 | Result                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:e2e`        | `chromium` (Desktop Chrome), `mobile-chromium` (Pixel 7) | 58 passed (4.0 min) at commit `65e3912`; `gift-performance.spec.ts` excluded by `--grep-invert @perf`                                                             |
| `pnpm test:e2e:chrome` | `installed-chrome` (part of `verify:local`)              | 29 passed (3.9 min) at commit `65e3912`; `gift-performance.spec.ts` excluded by `--grep-invert @perf`                                                             |
| `publish.spec.ts` ×3   | `chromium`, `mobile-chromium`, `--repeat-each=3`         | 12 passed (4.2 min) at commit `3786a83`: both journeys, three consecutive runs per project; not repeated at `65e3912`, where each journey passed once per project |
| `pnpm test:e2e:perf`   | `mobile-chromium`, one worker                            | 1 passed at commit `3786a83`; baseline below. The review fixes did not touch the recipient page's load path before the tap                                        |

Specs and what they prove for Gate M2:

- `publish.spec.ts`, parameterized over two content sets (`typical`, `edge-cases`), runs the whole
  journey: create → upload → customize → preview (played to its end) → sign in (the Studio claims
  the draft on return) → confirm and publish → idempotent replay and conflict → draft access ended →
  anonymous open on another browser context → static fallback with the artifact blocked → unknown
  share link (HTTP `404`). Every action goes through the UI
  or the app's own APIs; the test only reads `gifts` (the internal id, to compute the expected
  `giftRef`) and `analyticsEvents` for assertions, and deletes its records in cleanup. It writes
  nothing and intervenes in no step.
- `preview.spec.ts`, `studio.spec.ts`, `media-upload.spec.ts`, `memory-box.spec.ts` and
  `home.spec.ts` cover the preview controls and issues, autosave, offline and conflict, the real
  image upload, every template scene and fixture, and the auth and CSP baseline.

### Preview equals published

In both content sets, the test collects the masthead and the text of every `section[data-scene]`
while the preview plays, then again on `/g/{shareId}`, and requires the two lists to be equal
(`publish.spec.ts`, step 9). This proves the **text content of every scene**. Images, photo order
and theme are not compared yet (Sprint 4 debt D9 in the review document).

### Edge cases

The `edge-cases` run (`publish.spec.ts`) types and publishes:

- `receiver-name` at its maximum, `40/40`: Vietnamese with diacritics plus the ZWJ emoji 👩‍❤️‍👨;
- `anniversary-date` `2024-02-29`, shown as `29/02/2024`;
- `opening-message` at `120/120` with `<b>không đậm</b> & "trích dẫn"`;
- 8 photos, all JPEG (the three committed fixtures, reused; `photo.jpg` is landscape; no HEIC,
  WebP or PNG in E2E), with captions: one at exactly
  140 characters, one empty, one emoji-only (`🌲🇻🇳👍🏽`), one markup-like
  (`<b>đậm</b> & <img src=x onerror=alert(1)>`);
- `final-letter` at `1200/1200`: four paragraphs, an unbroken 90-character token, and NFD-decomposed
  `Tiếng Việt`.

It asserts that no `b` element exists in the frame, that nothing overflows horizontally in the host
or the frame, that `Tiếp` stays inside the frame viewport, and that the static fallback shows every
value, including `29/02/2024`, and all 8 photos.

### Visual snapshots

Each journey attaches, for `chromium` and `mobile-chromium`: the `/g` envelope, `opening`,
`memory-1`, a memory card without caption, `letter`, `finale` and the static fallback (Playwright
attachments `{typical|edge-cases}-published-*`). Scenes are frozen through the host's pause path
(the page reports hidden, the host sends `PAUSE`, the frame shows `data-paused`) and resumed with
`Tiếp tục`; `finale` is captured after `COMPLETE`. Layout assertions: no horizontal overflow,
`Tiếp` inside the frame, `Mở quà` and `Tiếp tục` at least 44 × 44 px, and the fallback region
scrolls to its last block. There are no pixel baselines; the attachments are for review.

### Funnel check

`publish.spec.ts` records every `POST /api/events` and reads `analyticsEvents` back:

- the creator page sends `customization_started`, `required_content_completed`, `preview_started`
  and `publish_clicked` exactly once each, under one `giftRef`, all answered `204`, with no path in
  `Referer`; the preview, played to its end, sends nothing;
- the replayed publish leaves exactly one stored `gift_published`, with `sessionId: null`;
- the anonymous recipient sends nothing before `Mở quà`, then `gift_open_interaction`,
  `scene_completed` for every scene in order (`opening`, `memory-1..n`, `letter`, `finale`) and
  `gift_completed`, each once, with `Origin` equal to the app origin on the `no-referrer` page and a
  session id distinct from the creator's;
- the fallback context sends only `gift_open_interaction`;
- every stored event has exactly the nine fields, a 180-day expiry, and none of the public id, share
  id, text values or asset ids.

### Template budget

`templates/memory-box/releases/1.1.0/build-metrics.json`: `initialJsKbGzip` **5.081** (budget 60),
`initialMediaKb` 0, `maxTextureMb` 0. The performance spec independently measured the artifact's
JavaScript, gzip-compressed from the response body, at **5 203 bytes** (assertion: at most 60 KiB).

### Database

- Schema version 9: `db:migrate` → `db:verify` → `db:migrate` passed on the local replica set
  (ledger `9`, `analyticsEvents` with `analytics_events_expiry_ttl` (TTL 0) and
  `analytics_events_name_occurred`).
- A scratch database built with the version-6 code (commit before `add-gift-preview`) reached
  version 9 in one `db:migrate` run, passed `db:verify`, kept its draft unchanged, and was dropped.
- MongoDB rejects an `analyticsEvents` document named `gift_viewed`, one without `expiresAt`, and
  one with a 64-character hex `giftRef`; it accepts the `analytics-event` and `analytics-event-ip`
  rate-limit scopes.

## Performance baseline (lab)

Command: `pnpm test:e2e:perf` (`--grep @perf --project=mobile-chromium --workers=1`, against the
production build served by `next start` on `127.0.0.1:3100`). Three cold runs per profile, each in a
new browser context (empty HTTP cache, service workers blocked), on a typical published gift (three
photos, no audio). Measured 2026-10-01.

Machine: Intel Core i3-14100 (4 cores, 8 threads), 32 GiB RAM, Windows 11 Pro 10.0.26200,
Node 22.23.2, Playwright 1.63.0 with Chromium 153.0.8010.12, Pixel 7 emulation.

| Profile     | TTFB (commit) ms | DCL ms | Envelope LCP ms (`H2`) | Before tap: requests / KiB | Payload end ms | Opening visible ms | First image end ms | Artifact KiB | Payload KiB | Images KiB | Audio KiB |
| ----------- | ---------------- | ------ | ---------------------- | -------------------------- | -------------- | ------------------ | ------------------ | ------------ | ----------- | ---------- | --------- |
| unthrottled | 16               | 104    | 358                    | 15 / 270.0                 | 215            | 342                | 271                | 19.8         | 1.9         | 5.7        | 0.0       |
| slow-4g     | 184              | 632    | 985                    | 17 / 270.4                 | 243            | 972                | 941                | 19.8         | 1.9         | 5.7        | 0.0       |

- Medians of three runs. Navigation times are wall-clock milliseconds from the start of the
  navigation; times after the tap are from the click on `Mở quà`.
- `slow-4g` = CDP `Network.emulateNetworkConditions` (150 ms latency, 1.6 Mbit/s down, 750 kbit/s
  up) plus `Emulation.setCPUThrottlingRate` 4. Chromium 153 does not show the emulated latency in
  Navigation or Resource Timing (`responseStart` stays a few milliseconds), so TTFB is the
  wall-clock commit time and request ends are the wall-clock `requestfinished` times. Follow-up
  requests on an open connection showed little of the emulated latency, so the throttled payload
  time understates a real 4G round trip.
- Before the tap the page loads only the document, one stylesheet, 11 framework scripts
  (256 KiB encoded) and the auth session fetches: no image, audio or gift payload request, and no
  request to another origin (both asserted).
- These are lab numbers on a desktop CPU, not a mid-range Android device. Real-device performance on
  staging is a pending manual check below.

## Gate M2 checklist

| Exit criterion (plan.md §12.6–12.7)                                      | Status                                         | Evidence or owner                                                                                                                                                                           |
| ------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E2E create → upload → customize → preview → internal publish → open      | Passed (automated)                             | `publish.spec.ts`, both projects, three consecutive runs                                                                                                                                    |
| Happy path without database intervention                                 | Passed (automated)                             | Actions use only the UI and the app's own APIs; the test reads `gifts`/`analyticsEvents` for assertions only, with no writes or interventions                                               |
| Preview and published content identical                                  | Passed (automated) for scene text              | `publish.spec.ts` step 9, both content sets; images and theme are not compared (review D9)                                                                                                  |
| A broken template never hides the core content                           | Passed (automated) for two failure modes       | `publish.spec.ts` step 10 (artifact blocked → load or INIT timeout, static fallback shows every value), `memory-box.spec.ts`; `RUNTIME_ERROR` after `READY` is unit-tested only (review D7) |
| Gift pinned to an immutable template version                             | Passed (automated)                             | `publish.spec.ts` (`/template-artifacts/memory-box/1.1.0/…`), `gift-publishing` spec and tests                                                                                              |
| Visual snapshots of the scenes                                           | Captured (attachments, no baseline comparison) | Playwright attachments `*-published-*`, layout assertions. Follow-up: the template Definition of Done needs real visual baselines                                                           |
| Text, emoji and photo edge cases                                         | Passed (automated); photos JPEG only           | `publish.spec.ts` `edge-cases` run; HEIC/WebP/PNG are staging charter C6 and review D13                                                                                                     |
| Basic analytics events through the whole funnel                          | Passed (automated)                             | `publish.spec.ts` funnel assertions and stored-event checks                                                                                                                                 |
| Cold-cache performance baseline recorded                                 | Passed (automated)                             | `pnpm test:e2e:perf`, table above (lab)                                                                                                                                                     |
| A non-technical person creates a real gift on staging                    | Pending (manual)                               | Owner: Product Owner. Record the staging gift and confirm `analyticsEvents` holds its full chain, `customization_started` to `gift_completed`, under one `giftRef`                          |
| Another person opens it in an anonymous browser on another device        | Pending (manual)                               | Owner: Product Owner                                                                                                                                                                        |
| Safari iOS and Chrome Android exploratory checks                         | Pending (manual)                               | Owner: QA. Follow `docs/quality/browser-support.md` and `docs/quality/mobile-audio-checklist.md`                                                                                            |
| Events stored from Safari iOS and from the Zalo in-app browser           | Pending (manual)                               | Owner: QA. Checks the `Origin` and `referrerPolicy: "strict-origin"` behavior outside Chromium                                                                                              |
| Zalo and Messenger link unfurlers store no event when the link is shared | Pending (manual)                               | Owner: QA. Share one staging link per app, then confirm no new event for that gift (open question in design)                                                                                |
| Real performance on staging                                              | Pending (manual)                               | Owner: Tech Lead. A mid-range Android device on a mobile network, against the lab table above                                                                                               |
| At least one licensed audio track for the demo                           | Pending (manual)                               | Owner: Product Owner. The licensed audio catalog is still empty; `audio` stays optional, so it does not block a gift                                                                        |
| Real issue list from the staging demo                                    | Pending (manual)                               | Owner: Product Owner. Add the issues found to "Known issues"                                                                                                                                |

## Known issues

| Issue                                                                                                                                                    | Severity (plan.md §19.4) | Decision                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser support is still inferred from Chromium emulation; Safari iOS, Chrome Android and Zalo in-app are unverified                                     | High (until checked)     | Manual Gate M2 check above; risk register "Browser support is inferred from emulation". The browser-support baseline required this before the Sprint 2 Viewer exit, so it is an open exception: Tech Lead owns it, and it expires at Gate M2 sign-off |
| A magic link opened in another browser cannot open an anonymous draft                                                                                    | Medium                   | Mitigated: automatic claim in the same browser, recovery text and sign-in hint; email OTP is PO decision P9 (risk register)                                                                                                                           |
| The licensed audio library is empty, so the demo gift has no music                                                                                       | Medium                   | Product Owner dependency (plan.md §12.7)                                                                                                                                                                                                              |
| Analytics counts an owner opening their own `/g` link as a recipient, and the bot substring match drops a few real browsers (for example `CUBOT` phones) | Low                      | Accepted bias, documented in ADR-0010; read open and completion counts as upper bounds                                                                                                                                                                |
| Recipients who see the static fallback never send `gift_completed`                                                                                       | Low                      | Accepted; fallback rates belong to technical observability (Sentry, Sprint 7)                                                                                                                                                                         |
| Lab throttling understates network latency for follow-up requests (Chromium 153 CDP emulation)                                                           | Low                      | Lab-only caveat; real-device staging measurement pending                                                                                                                                                                                              |
| Share links cannot be revoked until Sprint 4                                                                                                             | Medium                   | Accepted for Sprint 3; only `dev` and `stg` can publish (deployment runbook). Publishing now asks for confirmation first                                                                                                                              |
