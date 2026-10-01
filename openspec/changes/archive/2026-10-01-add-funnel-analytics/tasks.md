# Tasks

## 1. Pre-apply checks

- [x] 1.1 Right before starting apply, confirm that `add-memory-box-template`, `add-schema-driven-studio`, `add-local-object-storage`, `add-gift-preview` and `add-temporary-gift-publish` are archived and merged into the branch. Then re-diff the six MODIFIED `database-schema-management` blocks of this change against the then-current `openspec/specs/database-schema-management/spec.md`, following the provenance table in design D13, and merge any text that changed. Verify:
  - `corepack pnpm -s openspec validate add-funnel-analytics --strict` passes;
  - `node --import tsx scripts/check-openspec.ts` reports no error other than the "Schema verification" drop covered by task 1.2;
  - the code still has these, as design Context assumes:
    - `validateJsonMutationRequest`, `readJsonBody` and `publicReadRateLimitSubject`;
    - `DATABASE_SCHEMA_VERSION = 8`;
    - `getStudioGift` and `isLiveShare`;
    - `requestPreview` and `requestPublish`;
    - `GiftViewer` with `onLifecycleEvent` (`opened`, `scene`, `completed`, `fallback`);
    - `PublicGiftScreen`;
    - `apps/web/e2e/publish.spec.ts` with its `support/` helpers.
- [x] 1.2 Confirm that `openspec/gate-exceptions.json` holds a `modifiedBodyDrop` waiver for change `add-funnel-analytics`, capability `database-schema-management`, requirement "Schema verification", with owner `DevViTien`, an expiry, and the reason "Schema version moves to 9; the mismatch message example changes to expected 9." The coordinator records it while planning. If it is missing, add it first. If the archive (task 10.3) slips past the expiry, the owner extends it with a reason, and nobody unchecks tasks instead. Verify `node --import tsx scripts/check-openspec.ts` passes.

## 2. Contracts, configuration and body cap

- [x] 2.1 Add `packages/contracts/src/analytics.ts` and export it from the index. It holds `ANALYTICS_EVENT_NAMES`, `CLIENT_ANALYTICS_EVENT_NAMES`, `GiftRefSchema`, `AnalyticsSceneIdSchema`, `AnalyticsEventRequestSchema` (strict, with the `sceneId` rule) and `AnalyticsContextSchema` (design D2). Verify `analytics.test.ts` covers:
  - each of the seven client names accepted;
  - `gift_published` and `gift_viewed` rejected;
  - extra keys (`receiverName`, `shareId`) rejected;
  - `scene_completed` without `sceneId`, and `gift_completed` with one, rejected with the path `sceneId`;
  - `sceneId` `Memory 1` rejected;
  - a non-UUID `sessionId`, a 42- or 44-character `giftRef`, an uppercase `templateId` and a `templateVersion` of `1.1` rejected.
- [x] 2.2 Add `apps/web/src/config/analytics.ts` (`parseAnalyticsEnvironment`, `getAnalyticsEnvironment`, the one-time `analytics_misconfigured` warning), as design D7 describes. Document `ANALYTICS_ENABLED=false` and an empty `ANALYTICS_GIFT_REF_SECRET=` in `.env.example`. Verify `analytics.test.ts` covers:
  - `true` with a 32-character secret → enabled;
  - `true` with a 12-character or missing secret → disabled, with the warning once across two parses and never containing the value;
  - `false`, absent and `TRUE` → disabled;
  - no input throws.
- [x] 2.3 Add the `maxBytes` option to `readJsonBody` in `apps/web/src/http/api-response.ts`: a `Content-Length` pre-check plus a counted stream read that returns the `too-large` failure. Add a `413` `VALIDATION_ERROR` `Request body is too large.` response helper. Verify `api-response.test.ts` covers:
  - a declared `Content-Length: 4096`;
  - a 2049-byte chunked body without a length;
  - an exactly 2048-byte body accepted;
  - existing callers without the option behaving as before.

## 3. Database schema version 9

- [x] 3.1 In `packages/database`:
  - add `COLLECTIONS.analyticsEvents` and its definition: the validator of design D11, and the indexes `analytics_events_expiry_ttl` (TTL, `expireAfterSeconds: 0`) and `analytics_events_name_occurred`;
  - add `analytics-event` and `analytics-event-ip` to the `apiRateLimits` scope enum;
  - set `DATABASE_SCHEMA_VERSION` to `9`.

  Verify `migrations.test.ts` and `collections.test.ts` cover:
  - the definitions;
  - validator, TTL-index and version drift, reported with `MongoDB schema version mismatch: expected 9, received 1.`;
  - simulated version-`6`, `7` and `8` databases each reaching version `9` in one run without changing documents ("Upgrading a version 8 database" and the other upgrade scenarios).

- [x] 3.2 Run the migration on real replica sets:
  - against the local replica set at version `8`: `corepack pnpm db:migrate`, `corepack pnpm db:verify`, then `db:migrate` again. Verify both runs succeed, the ledger reads `9`, and `analyticsEvents` exists with both indexes;
  - in a scratch database built at version `6` (the procedure of `add-temporary-gift-publish` task 3.2): one run of this branch's `db:migrate` and `db:verify`. Verify the ledger reads `9`, then drop the scratch database.

  Verify, with `mongosh` or a one-off script, that inserting an `analyticsEvents` document with `name: "gift_viewed"` is rejected. Record in the PR that these checks ran, or that the coordinator ran them.

## 4. Analytics service and endpoint

- [x] 4.1 Add `modules/analytics/application/analytics-event.ts` (`ANALYTICS_RETENTION_DAYS`, `createAnalyticsEventRecord`) and `automated-traffic.ts` (`isAutomatedUserAgent`). Verify:
  - `analytics-event.test.ts` asserts:
    - the exact nine keys;
    - `sessionId: null` for `gift_published`;
    - `sceneId: null` unless the event is `scene_completed`;
    - `expiresAt` exactly 180 days after `occurredAt`;
  - `automated-traffic.test.ts` covers every listed substring in mixed case, missing and empty headers, and real Chrome Android, Safari iOS, Zalo in-app and Playwright device user agents, which are not automated.
- [x] 4.2 Add `modules/analytics/infrastructure/gift-ref.ts` (`createGiftRefFactory`, design D7). Verify `gift-ref.test.ts` pins:
  - a known vector;
  - the 43-character base64url output;
  - stability for one id;
  - different refs for different ids and for different secrets;
  - that the output never equals or contains the input id.
- [x] 4.3 Add `modules/analytics/infrastructure/mongo-analytics-event-repository.ts` (`insert`) and `modules/analytics/application/analytics-service.ts` (`recordBrowserEvent`, `recordGiftPublished`, `contextForGift`) with the ports `AnalyticsEventRepository` and `GiftRefFactory`. Verify:
  - `mongo-analytics-event-repository.test.ts` (mocked database) asserts the document inserted into `analyticsEvents`;
  - `analytics-service.test.ts` covers the browser and server records, and `contextForGift` returning `{ giftRef, templateId, templateVersion }`, or `null` when disabled.
- [x] 4.4 Add `analytics-event` (60 per 600 s) and `analytics-event-ip` (1200 per 600 s) to `ApiRateLimitScope` and `RATE_LIMITS` in `mongo-gift-rate-limiter.ts`. Confirm that `isSharedBucket` already recognizes `unidentified|…` subjects (it does, since `add-temporary-gift-publish`), add `analyticsSessionSubject`, and make the ×5 multiplier a per-scope choice that applies to `analytics-event-ip` but not to `analytics-event` (design D5). Verify `mongo-gift-rate-limiter.test.ts` covers:
  - the 61st event of one session ("One tab floods events");
  - the 1201st event across sessions ("Rotating session ids from one address");
  - for `unidentified`, 60 per session and 6000 in total ("Unidentified clients");
  - that the existing scopes keep their multipliers, including `public-gift-read` with an `unidentified|share:…` subject.
- [x] 4.5 Add `modules/analytics/presentation/events-route-handler.ts` with the order of design D4, `app/api/events/route.ts` re-exporting it, and `composition/analytics.ts`. Verify `events-route-handler.test.ts` covers every "Event collection endpoint", "Analytics rate limits", "Automated traffic exclusion" and "Analytics disabled" scenario:
  - `204` with no body, `Cache-Control: no-store` and `x-request-id`;
  - `400` for the unknown name, `gift_published`, an extra property, the `sceneId` rules and malformed JSON;
  - `413` for both oversize cases;
  - `415` for `text/plain;charset=UTF-8`;
  - `403` for a cross-site `Origin`, `Origin: null` and `Sec-Fetch-Site: cross-site`;
  - `429` with `Retry-After` from either counter;
  - `204` without storing and without charging for a bot, a missing user agent and disabled analytics;
  - no counter charged on `400`, `403`, `413` or `415`;
  - `500` with a log line holding only `analytics_event_store` and the request id.

## 5. Server hook points

- [x] 5.1 Add the `PublishAnalytics` port to `gift-service.ts`, and call it from `publishGift` only on the `published` repository outcome. Implement it in `composition/analytics.ts` with `after()` from `next/server`, catching and reporting failures as `analytics_gift_published`, and falling back to a detached promise when `after` throws (design D8). Verify:
  - `gift-service.test.ts` asserts one call with `{ giftId, templateId, templateVersion, requestId }` for "First publish", and none for "Replayed publish", each rejected outcome (`400`, `403`, `404`, `409`) and a thrown error;
  - `composition/analytics.test.ts` asserts that:
    - a rejected write is reported and never thrown;
    - disabled analytics writes nothing;
    - an `after` that throws falls back to the detached write;
  - `gift-service.test.ts` still returns the publication, and the gift stays published, when the port throws synchronously ("Analytics write fails"); the service wraps the call, because the route handler test uses a stubbed service. `publish-route-handler.test.ts` asserts that the route passes its `requestId`.
- [x] 5.2 Extend `getStudioGift` with an `AnalyticsContextFactory` port so that its draft result carries `analytics` (or `null`), and pass it from `app/studio/[publicId]/page.tsx` to `DraftEditor`. The published result carries none. Verify `gift-service.test.ts` covers:
  - the draft with analytics enabled and disabled;
  - the published gift having no analytics context;
  - no access still answering `NOT_FOUND`.
- [x] 5.3 Replace `PublicGiftService.isLiveShare` with `resolvePublicGiftPage(shareId)`, which returns `{ analytics }` or `null`, and update `app/g/[shareId]/page.tsx` to call `notFound()` on `null` and pass `analytics` to `PublicGiftScreen`. Verify `public-gift-service.test.ts`:
  - keeps every existing not-found case returning `null`, so page and endpoint still agree;
  - asserts that the context uses the publication's `templateId` and `templateVersion` and a `giftRef` of the gift id;
  - asserts `analytics: null` when analytics is disabled.

## 6. Browser client and Studio hooks

- [x] 6.1 Add `modules/analytics/presentation/analytics-client.ts` (`createAnalyticsClient` with `send` and `sendOnce`, design D3). Verify `analytics-client.test.ts` covers:
  - the exact request: `POST /api/events`, `Content-Type: application/json`, `keepalive: true`, `credentials: "omit"`, `cache: "no-store"`, `referrerPolicy: "strict-origin"` and no `mode`, with the body keys of D2;
  - fire-and-forget: a rejected promise and a synchronous throw of `fetch` are swallowed, with no retry;
  - the session id stored under `lm:analytics:session:{giftRef}`: created once, reused for the same gift, different for two gifts in one storage ("Two gifts in one tab"), replaced when malformed, and kept in memory per gift when storage throws ("Session storage blocked");
  - `sendOnce` deduplicated per name and `giftRef` across two client instances sharing storage;
  - no request for a `null` or invalid context, for `globalPrivacyControl` `true` and for `doNotTrack` `"1"` ("Privacy signal");
  - a `sceneId` that is not a valid slug skipped.
- [x] 6.2 Add `modules/analytics/presentation/studio-funnel.ts` (`trackStudioFunnel`, design D9) and the store selector `selectTemplateStepsComplete`. Verify `studio-funnel.test.ts`, with the real `createDraftEditorStore` and a fake client, covers:
  - "First autosave", including that a reload with the same storage sends nothing;
  - "Last required field saved";
  - "Draft already complete when opened";
  - "Failed save";
  - that `replaceFromServer` sends no `customization_started`;
  - that unsubscribing stops all events.
- [x] 6.3 Add the optional `report` callback to `requestPreview` (called just before returning `open`) and to `requestPublish` (called first, before `flush`), with a no-op default. Verify:
  - `preview-action.test.ts` asserts `preview_started` exactly once for `open`, and none for `blocked`, `rate-limited`, `gone` or `failed`;
  - `publish-action.test.ts` asserts `publish_clicked` before `flush` is called, including when `flush` then blocks;
  - the existing cases of both files still pass unchanged.
- [x] 6.4 Wire the Studio:
  - `DraftEditor` creates the client from its `analytics` prop, runs `trackStudioFunnel` in an effect with cleanup, and passes `client.send` as `report` to `readiness-step.tsx` and `publish-step.tsx`;
  - `publish-step.tsx` calls `requestPublish` only from the enabled, non-busy button.

  Verify:
  - `draft-editor.test.tsx` asserts that the tracker is subscribed and disposed on unmount, and that no request goes to `/api/events` when `analytics` is `null`;
  - `publish-step.test.tsx` asserts that a click on the disabled button sends no `publish_clicked` ("Disabled publish action"), and that a double click sends one.

## 7. Recipient hooks

- [x] 7.1 Add `modules/analytics/presentation/recipient-events.ts` (`createRecipientEventReporter`, design D10). Verify `recipient-events.test.ts` covers:
  - "Full play-through" (order and counts);
  - "Template fails after opening";
  - `scene` notifications after `completed` ignored;
  - a repeated `scene` id sent once;
  - an invalid scene id skipped;
  - `completed` without any scene;
  - no event from `fallback`.
- [x] 7.2 Wire `PublicGiftScreen`: create the client from its `analytics` prop and the reporter with `useMemo`, and pass `onLifecycleEvent` to `GiftViewer`. Verify `public-gift-screen.test.tsx` (no jest-dom matchers) asserts:
  - no `/api/events` request before `Mở quà`;
  - `gift_open_interaction` after a successful deferred load;
  - none after a failed load, then one after `Thử lại` succeeds ("Load fails on tap");
  - no request when `analytics` is `null`.
- [x] 7.3 Add regression tests that the preview and the harness never report. Verify:
  - `preview-screen.test.tsx` plays a ready source through `opened`, `scene` and `completed` and records no `/api/events` request ("Preview never reports recipient events");
  - the Viewer harness component test does the same.

## 8. Documentation

- [x] 8.1 Add `docs/adr/0010-first-party-funnel-analytics.md` (Accepted). It covers:
  - the context: tech-stack.md §17.2 and plan.md §3.2 and §20.3;
  - the decision: first-party events in MongoDB, a 180-day TTL, the `giftRef` HMAC, no vendor;
  - the rejected alternatives: PostHog or another vendor now, `sendBeacon`, an outbox;
  - the consequences and exit criteria: export to a warehouse when volume or analysis needs exceed design D11's estimate;
  - the known bias that owners opening their own `/g` link count as recipients, and that the bot substring match drops a few real browsers such as `CUBOT` phones;
  - Production off by default until the Sprint 6 privacy copy (accepted product decision).

  Link it from the ADR index or README if one exists. Verify the links resolve and `corepack pnpm format:check` passes.

- [x] 8.2 Add a "Funnel analytics" section to `docs/architecture.md`. It covers:
  - the taxonomy and the hook points;
  - the privacy rules (no content or identifiers, the pseudonym, no credentials, GPC and DNT);
  - the transport decision, the `Origin` caveat on `no-referrer` pages and the `strict-origin` request referrer policy;
  - session ids scoped per gift and tab;
  - that owners opening their own `/g` link count as recipients;
  - rate limits and bot exclusion;
  - retention;
  - a data inventory row (purpose, fields, retention);
  - the schema `9` rollback note from design "Migration Plan".

  Verify the links resolve and `format:check` passes.

- [x] 8.3 Update `docs/runbooks/preview-deploy-and-rollback.md`:
  - rows for `ANALYTICS_ENABLED` (`dev` and `stg`: `true`; Production: absent, the accepted default until the Product Owner turns it on, see design Migration Plan) and `ANALYTICS_GIFT_REF_SECRET` (48 random bytes as base64url, distinct per environment);
  - a "Rotating the analytics gift-ref secret" note: when to rotate, the effect that joins across the rotation are lost, and that the value is never logged or shared between environments.

  Verify `format:check` passes.

## 9. Gate M2 end-to-end evidence (run by the coordinator)

- [x] 9.1 Add `ANALYTICS_ENABLED: "true"` and `ANALYTICS_GIFT_REF_SECRET: process.env["ANALYTICS_GIFT_REF_SECRET"] || "playwright-analytics-gift-ref-secret-0001"` to the Playwright web server `env`. Add these helpers to `apps/web/e2e/support/`:
  - `analytics.ts`, which records each `POST /api/events` of a page: body, `Origin` and status;
  - `readAnalyticsEvents(giftRef)`, which polls `analyticsEvents` through `MongoClient` for up to 10 s;
  - `deleteAnalyticsEvents(giftRefs)`, used in `afterAll` by `publish.spec.ts` and `gift-performance.spec.ts`.

  Commit a landscape JPEG fixture without EXIF (under 60 KB) if none exists (the committed `photo.jpg` is 320×240 without EXIF, so none is added). Verify `corepack pnpm -s type-check` passes and the helpers are used by tasks 9.2–9.5.

- [x] 9.2 Extend the existing journey in `apps/web/e2e/publish.spec.ts` with the funnel assertions of design D12, without adding a second create-to-open journey. Extend journey step 9: after `memory-1`, press `Tiếp` through every memory card and `letter` until the template reports `COMPLETE`. Assert:
  - the creator events, each exactly once with one `giftRef`, and all `204`;
  - no recipient event name in the creator context, including the preview played to its end;
  - after the replayed publish, exactly one stored `gift_published` with `sessionId: null`;
  - in the anonymous context:
    - no event before `Mở quà`;
    - then `gift_open_interaction`, `scene_completed` for `opening`, `memory-1`, `memory-2`, `memory-3`, `letter` and `finale`, and `gift_completed`, each once;
    - `Origin` equal to the base URL ("Event from a no-referrer page");
    - a `sessionId` distinct from the creator's;
  - in the fallback context, only `gift_open_interaction`;
  - every stored document has exactly the nine keys, a 180-day expiry, and none of the `publicId`, the `shareId`, `receiver-name`, the captions, the letter text or the asset ids.

  Verify it passes on `chromium` and `mobile-chromium` against the production build.

- [x] 9.3 Add the visual snapshots of design D12 to `publish.spec.ts`: the `/g` envelope, `opening`, `memory-1`, a card without caption, `letter`, `finale`, and the static fallback. Freeze each scene with the visibility-pause technique (override both `document.hidden` and `document.visibilityState`, dispatch `visibilitychange`, and wait for the frame `body`'s `data-paused`), except `finale`, which is captured after `COMPLETE` (design D12); assert the scene before and after each capture, and attach the screenshots. Add the layout assertions:
  - no horizontal overflow in the host or the frame;
  - `Tiếp` inside the frame viewport;
  - `Mở quà` and `Tiếp tục` at least 44 × 44 px;
  - the fallback region scrollable to its last block.

  Verify the attachments appear in the report for both projects and the spec passes three consecutive runs locally.

- [x] 9.4 Add the edge-case content run of design D12 by parameterizing the same journey steps (no copied steps). Each run signs in with an e-mail unique per Playwright project and content parameter. The content covers:
  - the maximum lengths shown as `n/n` in the Studio;
  - Vietnamese NFC and NFD text, ZWJ, flag and skin-tone emoji;
  - markup-like text;
  - `29/02/2024`;
  - 8 photos including the landscape fixture, and one empty caption.

  Assert that preview and `/g` show identical text for every `section[data-scene]`, that there is no `b` element in the frame, that nothing overflows, and that the static fallback shows every value. Verify it passes on `chromium` and `mobile-chromium`.

- [x] 9.5 Add `apps/web/e2e/gift-performance.spec.ts` as design D12 describes, with its own command:
  - tag its tests `@perf`; add `--grep-invert @perf` to `test:e2e` and `test:e2e:chrome`; add the root script `test:e2e:perf` (`--grep @perf --project=mobile-chromium --workers=1`, same `.env` loading);
  - three cold runs for each of the `unthrottled` and `slow-4g` (CDP) profiles;
  - the listed metrics and medians, including the time to the `opening` scene and the first image's response end from network events;
  - deleting the gift's analytics events in `afterAll`;
  - `performance-baseline.json` and a Markdown table attached.

  It asserts only these:
  - the gzip-compressed artifact JS is at most 60 KiB;
  - no image, audio or `/api/public-gifts/` request happens before the tap;
  - no request goes to a non-app origin.

  Verify `corepack pnpm test:e2e:perf` passes and produces the attachment, and that `test:e2e` and `test:e2e:chrome` no longer run it.

- [x] 9.6 Write `docs/sprints/sprint-3-results.md` with the structure of design D12:
  - delivered changes;
  - the `verify:local` result with date and the tested commit SHA;
  - the E2E specs per project;
  - the performance baseline tables copied from the task 9.5 attachment, labelled as lab numbers, with the `test:e2e:perf` command and the machine (CPU, RAM, OS, Node and Chromium versions);
  - the template budget from `templates/memory-box/releases/1.1.0/build-metrics.json`;
  - the funnel check;
  - the Gate M2 checklist, with each exit criterion marked `Passed (automated)` with its evidence, or `Pending (manual)` with an owner field. Pending:
    - the staging demo by a non-technical person, whose gift has the full event chain in `analyticsEvents`, from `customization_started` to `gift_completed`, under one `giftRef`;
    - an anonymous open on another device;
    - Safari iOS and Chrome Android exploratory checks;
    - events stored from Safari iOS and from the Zalo in-app browser;
    - the Zalo and Messenger link unfurlers storing no event when the link is shared;
    - real performance on staging;
    - the licensed audio track;
  - known issues with severity.

  Verify every automated claim cites a spec, a command or an attachment, and `format:check` passes.

## 10. Verification and archive

- [x] 10.1 Run `corepack pnpm verify:local` and confirm it passes: secrets, spec:check, format, lint, types, coverage (including per-file thresholds for the new `.ts` files), audit, build, and installed-Chrome E2E including `publish.spec.ts` (`gift-performance.spec.ts` runs only through `test:e2e:perf`, task 9.5). Record any step that cannot run locally and why.
- [x] 10.2 Re-run the design D13 re-diff once more immediately before archiving, in case another change was archived meanwhile. Verify `corepack pnpm -s openspec validate add-funnel-analytics --strict` passes.
- [x] 10.3 Archive the change with `/opsx:archive add-funnel-analytics` in the same PR, and remove this change's `modifiedBodyDrop` waiver from `openspec/gate-exceptions.json`. Verify `corepack pnpm spec:check` passes afterwards.

## Out of scope

- Dashboards, funnel queries, rollups and exports; a warehouse or third-party analytics vendor (ADR-0010 names the trigger).
- The events `template_demo_started`, `checkout_started`, `payment_succeeded`, `reaction_sent` and `gift_replayed`, and reactions (Sprint 4–5).
- A consent banner, an in-app opt-out and privacy-notice copy (plan.md §20.3, Sprint 6). Only GPC and DNT are honored now.
- Enabling analytics in Production. Production stays off by accepted product decision until the Sprint 6 privacy copy; turning it on is an environment change with no code change.
- Viewer fallback rates, Sentry and real-user Web Vitals (technical observability, Sprint 7).
- Performance thresholds enforced in CI, and real-device performance measurement (a manual Gate M2 check recorded in the results document).
- Carrying out the manual Gate M2 checks: the staging demo by a non-technical person, Safari iOS and Chrome Android exploratory checks, and real staging performance. The Product Owner records their outcomes in `docs/sprints/sprint-3-results.md`.
- A key version for `giftRef`, which a planned secret rotation would need.
- Batching several events per request.
