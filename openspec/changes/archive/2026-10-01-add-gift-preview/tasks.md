# Tasks

## 1. Pre-apply checks

- [x] 1.1 Right before starting apply, confirm that `add-memory-box-template`, `add-schema-driven-studio` and `add-local-object-storage` are archived and merged into the branch. Then re-diff every MODIFIED block of this change against the then-current `openspec/specs/`:
  - `studio-editor` "Studio preview and publish steps" and `template-viewer-runtime` "Lifecycle control" against the text their earlier change archived;
  - every other block against its main spec (see design D9).

  Merge any text that changed. Verify:
  - `corepack pnpm -s openspec validate add-gift-preview --strict` passes with no INFO about a missing `studio-editor` spec;
  - `node --import tsx scripts/check-openspec.ts` reports no warning for this change;
  - the code still has `flush(): Promise<FlushResult>`, `studio-field-{fieldId}` ids, `readiness-step.tsx`, the `memory-box@1.1.0` artifact and the driver-aware `composition/media.ts` that this design assumes.

  Status at apply (run by coordinator): the three earlier changes are merged but not yet archived, so the INFO and the gate warning for `studio-editor` remain until `add-schema-driven-studio` is archived. The re-diff was run against the current main specs and the earlier changes' deltas: every MODIFIED block keeps all base scenarios and backticked identifiers, apart from the waived `expected 6` message. The code assumptions hold.

- [x] 1.2 Confirm that `openspec/gate-exceptions.json` still holds the `modifiedBodyDrop` waiver the coordinator recorded: change `add-gift-preview`, capability `database-schema-management`, requirement "Schema verification", owner `DevViTien`, expires `2026-10-31`. If the archive (task 10.3) cannot happen by `2026-10-31`, the owner extends the expiry with a reason, and nobody unchecks tasks instead. Verify `node --import tsx scripts/check-openspec.ts` passes.

## 2. Contracts, rate-limit scope and database schema version 7

- [x] 2.1 Add `CreateGiftPreviewRequestSchema` (strict `{}`), `GiftPreviewLinkDtoSchema` (strict `{ url, expiresAt }`, with `url` matching `^/preview/[A-Za-z0-9_-]{43}$` and `expiresAt` an ISO datetime) and `GiftPreviewLinkResponseSchema` to `packages/contracts/src/gift.ts`, and export them. Verify `gift.test.ts` accepts a valid link and rejects extra keys, a 42-character token, an absolute URL and a non-empty request body.
- [x] 2.2 Add `gift-preview` (30 requests per 600 seconds) to `GiftMutationScope` and `RATE_LIMITS` in `mongo-gift-rate-limiter.ts`. Verify `mongo-gift-rate-limiter.test.ts` shows the 31st call in one window is refused, and a shared `unidentified` bucket allows 150.
- [x] 2.3 In `packages/database`:
  - add `COLLECTIONS.previewTokens`;
  - add its collection definition (the validator from design D8 and the TTL index `preview_tokens_expiry_ttl` on `expiresAt` with `expireAfterSeconds` `0`);
  - add `gift-preview` to the `apiRateLimits` scope enum;
  - set `DATABASE_SCHEMA_VERSION` to `7`.

  Verify that `migrations.test.ts` and `collections.test.ts` cover these, and that validator, index and version drift is still detected, with `MongoDB schema version mismatch: expected 7, received 1.`.

- [x] 2.4 Run `corepack pnpm db:migrate`, then `corepack pnpm db:verify`, then `corepack pnpm db:migrate` again against the local replica set that was seeded at version `6`. Verify both runs succeed, the ledger reads `7`, and `previewTokens` has the validator and TTL index. Record in the PR that this was run, or that the coordinator ran it. (Run by coordinator: no MongoDB was reachable from the apply worktree. The upgrade from version `6` is covered by `migrations.test.ts`.)

## 3. Viewer payload transformer

- [x] 3.1 Add `findSelectableTrack(id)` to `AudioCatalogService` in `modules/audio/application/audio-catalog.ts`. It returns the DTO for `active` tracks only. Verify `audio-catalog.test.ts` covers active, withdrawn and unknown ids.
- [x] 3.2 Add `modules/viewer/application/viewer-payload.ts` (the types and `issueKey`) and `build-viewer-payload.ts` as design D2 describes. Verify `build-viewer-payload.test.ts` covers every `viewer-payload` scenario with fake ports, and the file meets the per-file coverage thresholds. The scenarios:
  - "Same input, same output shape" and "No storage details leak";
  - "Current Memory Box draft", "Version without an artifact", "Pinned artifact matches" and "Pinned artifact differs";
  - "Captioned images unchanged" and "Incomplete draft";
  - "Ready asset signed at 768 pixels" (including `assetsExpireAt`), "Small source image", "Asset still processing", "Asset of another field or gift" and "No images";
  - "Selected active track", "No music" and "Withdrawn track";
  - "Memory Box fields";
  - "Empty Memory Box draft", "Too few photos, one still processing" (`CONTENT_TOO_FEW`), "Invalid item" (`itemIndex` from the second path segment) and "Complete gift".
- [x] 3.3 Export the storage adapter factory from `composition/media.ts` without changing how it is built (additive). Add `composition/viewer.ts`, which supplies `buildViewerPayload`'s ports from the artifact registry, the storage adapter and `audioCatalog`. Verify `corepack pnpm -s type-check` passes, and that ESLint boundaries report no violation for `modules/viewer`.

## 4. Preview links: tokens, service and issue route

- [x] 4.1 Add `modules/preview/application/preview-token.ts` (`generatePreviewToken`, `hashPreviewToken`, `isPreviewTokenFormat`, `PREVIEW_TOKEN_TTL_SECONDS`). Verify `preview-token.test.ts` checks:
  - a 43-character base64url token from 32 random bytes;
  - the hash is 64 lowercase hex characters and differs from the token;
  - the format check rejects 42 and 44 characters, `+`, `/` and `=`.
- [x] 4.2 Add `findDraftById(giftId)` (filter `{ _id, status: "draft" }`) to the `GiftRepository` port and `mongo-gift-repository.ts`. Verify `mongo-gift-repository.test.ts` asserts the filter, and that a non-draft gift yields `null`.
- [x] 4.3 Add `modules/preview/infrastructure/mongo-preview-token-repository.ts` (`insert`, and `findActive(hash, now)` with the filter `{ _id: hash, expiresAt: { $gt: now } }`). Verify `mongo-preview-token-repository.test.ts`, with a mocked `getDatabase`, asserts:
  - the stored document holds only `_id` (the hash), `giftId`, `createdAt` and `expiresAt`;
  - the lookup filter includes the expiry.
- [x] 4.4 Add `modules/preview/application/preview-service.ts` (`createPreviewLink`, `openPreview`) as design D3 describes. Verify `preview-service.test.ts` with fake ports covers:
  - "Owner requests a preview link", "Non-owner denied opaquely" and "Published or deleted gift";
  - an unresolved manifest → `INVALID_STATE`;
  - "Latest content shown", "Unknown or malformed token" (no repository call for a malformed token), "Expired token" and "Gift no longer a draft";
  - "Draft pinned to memory-box 1.0.0" (`artifactUrl` `null`, no error).
- [x] 4.5 Add `modules/preview/presentation/preview-route-handler.ts` and `app/api/gifts/[publicId]/preview/route.ts` with the guard order from design D3 and a `201` response. Wire `composition/preview.ts`. Verify `preview-route-handler.test.ts` covers:
  - `201` with a valid body;
  - `404` for a malformed id, no credentials, a non-owner or a non-draft;
  - `409` `CONFLICT` for an unresolved version;
  - `415` for `text/plain`, and `400` for `{ "ttl": 99999 }`;
  - `403` for a cross-site `Origin`, without charging the rate limit;
  - `429` with `Retry-After`;
  - `500` with a log line that holds only the event name and request id (no token, no `publicId`).

## 5. Preview route shell, CSP and headers

- [x] 5.1 Add `pathname === "/preview" || pathname.startsWith("/preview/")` to the nonce branch of `getContentSecurityPolicyMode`. Verify `content-security-policy.test.ts` and `proxy.test.ts` cover "Preview uses the nonce policy" and "Look-alike path stays static" (`/previews`, `/preview-guide`).
- [x] 5.2 Make two additive edits to `apps/web/next.config.ts`:
  - a `headers()` entry for `/preview/:path*` with `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` and `Cache-Control: private, no-store`, placed after the global entry;
  - `/^\/preview\//` in `logging.incomingRequests.ignore`.

  Verify a config unit test asserts the entry, its order after `/:path*`, and the ignore pattern.

- [x] 5.3 Add `app/preview/layout.tsx` (`await connection()`) and `app/preview/[token]/page.tsx`. The page:
  - has `dynamic = "force-dynamic"`;
  - has the metadata title `Xem trước quà`, which the root template turns into `Xem trước quà · LoveMemory`, with `robots` noindex;
  - calls `notFound()` when `openPreview` returns `null`;
  - computes `canEdit` with `getGiftRequestContext` and `findAuthorized` (design D4).

  Do not add a `loading.tsx` under `/preview`. Verify `corepack pnpm build` lists `/preview/[token]` as dynamic with no static output under `/preview`, and a page-level test (or the E2E) shows the title and that `canEdit` is `false` without credentials.

## 6. Gift viewer

- [x] 6.1 Add `modules/viewer/presentation/static-gift-content.ts` (`toStaticGiftBlocks`). Verify `static-gift-content.test.ts` covers:
  - field order;
  - `longText` line breaks kept;
  - a `date` formatted `DD/MM/YYYY` without time-zone shift;
  - captioned items with and without a URL or caption (`Ảnh {n}`);
  - `theme` and `audio` skipped;
  - wrong-typed values skipped;
  - the markup string kept as plain text data.
- [x] 6.2 Add `modules/viewer/presentation/gift-viewer-controller.ts` as design D5 describes. It covers:
  - ready and deferred sources;
  - phases and runtime states;
  - `mounted()` before `src`;
  - the handshake budget per load and a 15-second load timeout from `src`;
  - the issue map, audio results and visibility;
  - lifecycle events;
  - the one-time asset refresh.

  Verify `gift-viewer-controller.test.ts`, with fake timers, a fake bridge and a fake audio controller, covers every `gift-viewer` scenario that needs no DOM:
  - "Ready source loads behind the envelope", "Deferred source loads on tap" and "Deferred load fails" (including a successful `Thử lại`);
  - "Open a ready template", "Tap before the template is ready", "Cached artifact on reload" (a `load` reported before `mounted()` is ignored, and the one after `src` is counted), "Initial blank document load" and "Nothing plays without the gesture";
  - "Audio starts with the opening gesture", "Deferred audio after the load" (the unlock `play()` happens synchronously in `open()`), "Autoplay policy blocks audio", "Mute" and "Gift without music";
  - "Fallback after the asset URLs expired" for both sources, with a second image failure showing the caption;
  - "Full play-through notifications" and "Fallback notification";
  - "Switch apps during the gift", "Hidden while opening" (a ready source before `READY`, a deferred source during its load, and an opening that ends in the fallback) and "Hidden before opening";
  - "Forced reduced motion";
  - "Template runtime error", "Template never becomes ready" and "No artifact";
  - "Duplicate issues" and "Issue from another window";
  - "Slow artifact load in the gift viewer", "Gift viewer waits for READY" and "Unmounting the gift viewer";
  - `ERROR` before opening, which keeps the envelope;
  - a controller disposed right after `mounted()` (a Strict Mode double mount) reports no `NO_ARTIFACT` fallback.

  Verify the file meets the per-file coverage thresholds.

- [x] 6.3 Add `gift-viewer.tsx` and `static-gift-content-view.tsx` (a `.tsx` cannot share the `.ts` model's module name), with the props from design D5:
  - the envelope (`Bạn có một món quà`, `Mở quà`, `Đang mở quà…`);
  - the load failure message with `Thử lại`;
  - an iframe with `sandbox="allow-scripts"`, the title `LoveMemory template viewer`, and `aria-hidden` and `tabIndex={-1}` while the envelope is shown. It is rendered without `src`, and `src` is set in a client effect after `onLoad` is attached. With a deferred source, the iframe is created only after the load succeeds;
  - the audio element with `preload="none"`;
  - `Tắt tiếng`/`Bật tiếng` with `aria-pressed`, and `Tiếp tục`;
  - `Không phát được nhạc.`;
  - focus management, and the static region `Nội dung món quà` with no-referrer images and text-only rendering.

  Verify `gift-viewer.test.tsx` (no jest-dom matchers) covers:
  - the envelope;
  - a deferred source rendering no content and no iframe before the tap;
  - the server-rendered iframe having no `src`;
  - the mute toggle;
  - the fallback content for "Markup in content";
  - no mute control when `audioUrl` is `null`;
  - an iframe `load` while its `src` attribute is `about:blank` posts no `INIT`, and one of the artifact URL does;
  - focus moving to the static content when the template sends `ERROR` during the gift.

## 7. Preview page, controls and issues panel

- [x] 7.1 Add `modules/preview/presentation/preview-issues.ts` (`mergePreviewIssues`, `describeIssue`) with the messages from `gift-preview` "Issues panel". Verify `preview-issues.test.ts` covers:
  - "Missing fields and a broken photo", "Same issue from server and template" and "Complete gift";
  - the `CONTENT_TOO_FEW` message with `minItems`, the `CONTENT_INVALID` message with and without `itemIndex`, and the `ASSET_UNAVAILABLE` 1-based photo number;
  - the grouped unknown-field entry;
  - `Sửa` hrefs of the form `/studio/{publicId}?field={fieldId}` when `canEdit` is true, and no hrefs when it is false.
- [x] 7.2 Add `preview-screen.tsx` and `issues-panel.tsx`:
  - the viewport buttons `Điện thoại`/`Máy tính` with `aria-pressed`, changing CSS only;
  - `Phát lại` and `Giảm chuyển động`, both through `router.refresh()` and a client `generation` remount key;
  - `onAssetsExpired` through `router.refresh()` without changing the key;
  - no reporting `onLifecycleEvent` handler;
  - the private-link notice, `Quay lại chỉnh sửa` (only when `canEdit`), the `Mở Studio trên thiết bị đã tạo quà để sửa.` hint and the no-artifact notice;
  - the template-error notice, `Cần hoàn thiện` and `Không phát hiện vấn đề nào.`

  Render it from the page. Verify `preview-screen.test.tsx`, with `next/navigation` mocked, covers:
  - "Switch to desktop viewport": no remount, and no new `INIT` through a fake viewer;
  - "Restart with fresh content" and "Reduced motion toggle": `router.refresh` is called and the viewer remounts;
  - asset expiry: `router.refresh` is called and the viewer is not remounted;
  - the notices for "Draft pinned to memory-box 1.0.0";
  - "Fix a field from the preview": the link href;
  - "Preview opened on a device that cannot edit".

- [x] 7.3 Add a "Preview and gift viewer" section to `docs/architecture.md`. It covers:
  - the single transformer and why the published Viewer must reuse it;
  - the preview token model (a bearer capability, hashed, 30 minutes, not revocable);
  - the not-found streaming status;
  - why restart refreshes signed URLs;
  - the gift viewer sources (ready and deferred), fallback rules and lifecycle notifications;
  - the schema version `7` rollback note from design "Migration Plan".

  Verify the links resolve and `corepack pnpm format:check` passes.

## 8. Studio `Xem trước` action

- [x] 8.1 Add `modules/gifts/presentation/studio/preview-action.ts` (`requestPreview`) as design D7 describes. Verify `preview-action.test.ts` covers:
  - `flush` results `saved`, `offline`, `invalid`, `conflict` and `failed`: only `saved` sends a request;
  - `201` with a valid body → `open`, and an invalid `201` body → `failed`;
  - `429` → `rate-limited` with `retryAfterSeconds`;
  - `404` → `gone`;
  - `500` and a rejected fetch → `failed`;
  - the request carries `Content-Type: application/json` and the body `{}`.
- [x] 8.2 Enable the `Xem trước` button in `readiness-step.tsx`:
  - it is disabled with `Đang mở bản xem trước…` while busy, and a `pageshow` with `persisted` (back/forward cache restore) resets it;
  - it navigates with `window.location.assign(url)`;
  - it shows the `429` and failure messages, and `gone` goes through the store's non-editable path;
  - `Xuất bản` stays disabled with `Sắp ra mắt`.

  Verify `readiness-step.test.tsx` covers "Preview after a pending change", "Preview of an incomplete draft", "Preview blocked by an unsaved state", "Preview rate limited", "Preview request fails", "Double click", "Back from the preview" and the unchanged "Action not yet available".

## 9. End-to-end journey (run by the coordinator)

- [x] 9.1 Add `apps/web/e2e/preview.spec.ts`. It relies on the local object storage web server of `add-local-object-storage`. The journey:
  1. Create a `memory-box@1.1.0` draft.
  2. Open `/studio/{publicId}?field=memories`, upload the committed JPEG fixture through `#studio-field-memories`, confirm the crop, wait for the ready image and type the caption `Đà Lạt 2023 🌲`.
  3. Wait for `Đã lưu`, open step `Xem trước` and choose `Xem trước`.
  4. Assert the URL is `/preview/{token}`, and that the page response has `Cache-Control` with `private` and `no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer` and a CSP with `'strict-dynamic'`.
  5. Assert the issues panel lists the missing `receiver-name` and the `memories` minimum, each with `Sửa`.
  6. Choose `Mở quà`, then press `Tiếp` inside the frame until `memory-1`. Assert the photo inside the iframe has `naturalWidth > 0` and the caption text is visible. Attach screenshots.
  7. Choose `Máy tính` and `Phát lại`, and see the envelope again.
  8. Reload the preview page, so the artifact is served from the browser cache. Choose `Mở quà` and assert `memory-1` shows the photo, with no static fallback ("Cached artifact on reload").
  9. In a fresh browser context without cookies:
     - open the same preview URL and assert it renders, and that the issues show no `Sửa` link and show `Mở Studio trên thiết bị đã tạo quà để sửa.`;
     - assert `GET /api/gifts/{publicId}` answers `404` in that context.
  10. In another fresh page, use `page.route('**/template-artifacts/**', r => r.fulfill({ contentType: 'text/html', body: '<html></html>' }))`, open the preview URL and choose `Mở quà`. After the timeout, assert the static region `Nội dung món quà` shows the caption `Đà Lạt 2023 🌲` and the photo with `naturalWidth > 0`, and that the panel shows the template-error notice.
  11. Back in the owner context, choose `Sửa` for `receiver-name`, and assert the Studio URL becomes `?step=recipient` and `#studio-field-receiver-name` has focus.
  12. Assert `/preview/` plus 43 random characters renders `Kỷ niệm này chưa tồn tại.` with `X-Robots-Tag: noindex`.
  13. With `request`, assert the preview `POST` from a fresh context without cookies is `404`, and with `text/plain` is `415`.

  The spec imports `{ expect, test }` from `./test`, and each context it creates with `browser.newContext()` (steps 9 and 10) calls `assignOwnAuthClientAddress`, so every context has its own Better Auth rate-limit bucket.

  Verify it passes on `chromium` and `mobile-chromium` against the production build. The coordinator runs it after merging; never run it inside a worktree. (The spec is written; run by coordinator.)

## 10. Verification and archive

- [x] 10.1 Run `corepack pnpm verify:local` and confirm it passes: secrets, spec:check, format, lint, types, coverage (including per-file thresholds for the new `.ts` files), audit, build, and installed-Chrome E2E including `preview.spec.ts`. Record any step that cannot run locally and why.
- [x] 10.2 Re-run the design D9 re-diff once more immediately before archiving, in case another change was archived meanwhile. Verify `corepack pnpm -s openspec validate add-gift-preview --strict` passes.
- [x] 10.3 Archive the change with `/opsx:archive add-gift-preview` in the same PR, and remove this change's `modifiedBodyDrop` waiver from `openspec/gate-exceptions.json`. Verify `corepack pnpm spec:check` passes afterwards.

## Out of scope

- Publishing, share ids, the public Viewer `/g/{shareId}`, its payload endpoint and the `ViewerPayloadDtoSchema` contract (`add-temporary-gift-publish`, which reuses `buildViewerPayload` and `GiftViewer`).
- Funnel events such as `preview_started` (`add-funnel-analytics`).
- Revoking preview links before expiry, listing them, or deleting them when a gift is deleted (Sprint 6 privacy and deletion work). Links already stop working when a gift leaves `draft`.
- Keeping the token out of hosting platform access logs, for example with a fragment-based preview URL and a client-side payload fetch (Sprint 6 security hardening).
- A real `404` HTTP status for unknown preview links, which would need a proxy database lookup or removing the root `loading.tsx`.
- Converging the Viewer harness (`ViewerShell`) onto the gift viewer controller.
- Scene seeking or jumping from an issue to a scene.
- Pixel-diff baselines for preview screenshots.
