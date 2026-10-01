# Tasks

## 1. Pre-apply checks

- [x] 1.1 Right before starting apply, confirm that `add-memory-box-template`, `add-schema-driven-studio`, `add-local-object-storage` and `add-gift-preview` are archived and merged into the branch. Then re-diff every MODIFIED block of this change against the then-current `openspec/specs/`, following the provenance table in design D13, and merge any text that changed. Verify:
  - `corepack pnpm -s openspec validate add-temporary-gift-publish --strict` passes with no INFO about a missing `studio-editor` spec;
  - `node --import tsx scripts/check-openspec.ts` reports no warning for this change;
  - the code still has `buildViewerPayload` with `expectedContentHash`, `ViewerSource` `{ kind: "deferred" }`, `GiftViewer`, `flush(): Promise<FlushResult>`, `readiness-step.tsx`, `composition/viewer.ts`, `AudioCatalogService.findSelectableTrack`, the `memory-box@1.1.0` artifact and `DATABASE_SCHEMA_VERSION = 7`, as design Context assumes.
- [x] 1.2 Confirm that `openspec/gate-exceptions.json` holds the two `modifiedBodyDrop` waivers of design D13 for change `add-temporary-gift-publish`, both with owner `DevViTien` and an expiry:
  - `database-schema-management` / "Schema verification", which the coordinator already recorded while planning;
  - `studio-editor` / "Studio preview and publish steps", which is **not recorded yet**. The coordinator adds it right after `add-gift-preview` is archived; before that it would match nothing and fail the gate. If it is still missing when apply starts, add it first (owner `DevViTien`, reason: the `Xuất bản` button is enabled, so `Sắp ra mắt` is intentionally dropped).

  If the archive (task 11.3) slips past an expiry, the owner extends it with a reason, and nobody unchecks tasks instead. Verify `node --import tsx scripts/check-openspec.ts` passes.

## 2. Domain and contracts

- [x] 2.1 Add `ShareIdSchema` to `packages/domain/src/gift/gift-identity.ts`, and the optional `shareId` and `publishedAt` to `GiftSchema` with the status invariant of design D2. Make `toDocument` in `mongo-gift-repository.ts` omit `undefined` fields. Verify:
  - `gift-identity.test.ts` accepts 22 base64url characters and rejects 21, 23, `+` and `=`;
  - `gift-schema.test.ts` rejects a `published` gift without `shareId` and a `draft` with one;
  - `mongo-gift-repository.test.ts` asserts that a draft document has no `shareId` key.
- [x] 2.2 Add `packages/domain/src/gift/gift-publication.ts` (`publishGiftDraft`, `GiftPublicationSchema`, `createGiftPublication`) and the `GIFT_NOT_OWNED` error code, and export them. Verify `gift-publication.test.ts` and `gift-status.test.ts` cover every transition case of design D2, including:
  - `draft → publishing → published` allowed;
  - `draft → published`, `published → publishing` and `deleted → publishing` refused;
  - `publishGiftDraft` for `GIFT_NOT_DRAFT`, `GIFT_REVISION_CONFLICT`, `GIFT_NOT_OWNED` and success (revision unchanged, `publishedAt` = `updatedAt` = now);
  - a snapshot copied from the gift, and a refused snapshot of a non-published gift.
- [x] 2.3 Add `PublishGiftRequestSchema`, `GiftPublicationDtoSchema`, `GiftPublicationResponseSchema` and the `ShareIdSchema` re-export to `packages/contracts/src/gift.ts`. Add `packages/contracts/src/viewer.ts` with `ViewerPayloadDtoSchema` and `PublicGiftResponseSchema` (design D11), and export them. Verify `gift.test.ts` and `viewer.test.ts` show that:
  - valid values pass;
  - extra keys, a negative `expectedRevision`, a `sharePath` with another prefix, an `issues` key and an absolute `artifactUrl` are rejected;
  - a type-level check keeps `ViewerPayloadDtoSchema` equal to `ViewerPayload` without `issues`.

## 3. Database schema version 8

- [x] 3.1 In `packages/database`:
  - add `COLLECTIONS.giftPublications` and its definition (validator and the indexes `gift_publications_share_id_unique` and `gift_publications_gift_revision_unique`);
  - add `shareId` and `publishedAt` to the `gifts` validator, and the index `gifts_share_id_unique` (unique, partial on `shareId` of type string);
  - add `gift-publish`, `public-gift-read` and `public-gift-read-ip` to the `apiRateLimits` scope enum;
  - set `DATABASE_SCHEMA_VERSION` to `8`.

  Verify `migrations.test.ts` and `collections.test.ts` cover the definitions, and that validator, index and version drift is still detected, with `MongoDB schema version mismatch: expected 8, received 1.`. Also verify a test that simulates a version-`6` database (no `previewTokens`, no `giftPublications`, the version-6 `apiRateLimits` enum) and reaches version `8` in one run ("Upgrading a version 6 database").

- [x] 3.2 Run the migration on real replica sets along both upgrade paths:
  - **From 7:** against the local replica set seeded at version `7`, run `corepack pnpm db:migrate`, then `corepack pnpm db:verify`, then `corepack pnpm db:migrate` again. Verify both runs succeed, the ledger reads `8`, and `giftPublications` and `gifts_share_id_unique` exist.
  - **From 6:** this is the path `stg` takes if it skips the version-7 deployment.
    1. In a scratch database (for example `MONGODB_DATABASE=love_memory_v6_upgrade`), build a version-6 schema by running `db:migrate` and `db:seed` from the last commit before `add-gift-preview`'s migration, in a temporary `git worktree`.
    2. Insert one draft.
    3. Run this branch's `db:migrate` and `db:verify`.

    Verify the ledger reads `8`, `previewTokens` and `giftPublications` exist, and the draft is unchanged. Drop the scratch database afterwards.

  Record in the PR that both were run, or that the coordinator ran them.

## 4. Entitlement flag and rate-limit scopes

- [x] 4.1 Add `apps/web/src/config/internal-publish.ts` (design D3), and document `INTERNAL_PUBLISH_ENABLED=false` in `.env.example`. Add three things to `docs/runbooks/preview-deploy-and-rollback.md`:
  - the per-environment row (`dev` and `stg`: `true`; Production: absent);
  - a "Share links in platform logs" note (design Risks). It records:
    - that Vercel request logs keep `/g/{shareId}` paths;
    - who can read them (project members and their roles);
    - that log retention depends on the Vercel plan and any log drain, to be checked in the dashboard (no figure asserted);
    - that no log drain may be added without stripping `/g/` and `/api/public-gifts/` paths;
    - that links cannot be revoked until Sprint 4 (plan.md §13.1–13.2);
  - the rollback caveat for published gifts from design "Migration Plan".

  Verify `internal-publish.test.ts` covers `true`, `false`, absent, `TRUE`, `1` and `VERCEL_ENV=production` with `true`, and that none of them throws.

- [x] 4.2 In `mongo-gift-rate-limiter.ts`:
  - add three scopes to `ApiRateLimitScope` and `RATE_LIMITS`:
    - `gift-publish`: 10 per 600 s;
    - `public-gift-read`: 60 per 600 s, per network subject and share id;
    - `public-gift-read-ip`: 600 per 600 s, per network subject;
  - add and export `publicReadRateLimitSubject(request)` (design D8): IPv4 as is, IPv6 reduced to its `/64` prefix, otherwise `unidentified`.

  Verify `mongo-gift-rate-limiter.test.ts` shows:
  - these requests in one window are refused:
    - the 11th publish;
    - the 61st read of one share id ("Public read limit exceeded for one link");
    - the 601st read across share ids ("Scanning many links from one address");
  - 30 share ids read 3 times each from one address all pass ("Shared address opening different gifts");
  - `2001:db8:1:2::a`, `2001:DB8:1:2:0:0:0:b` and `2001:db8:1:2::b` give one subject, and `2001:db8:1:3::a` gives another ("IPv6 addresses in one /64");
  - the `unidentified` buckets allow 300 reads per share id and 3000 in total;
  - `publicReadRateLimitSubject` ignores sessions, cookies and `x-forwarded-for`.

## 5. Publish service and API

- [x] 5.1 Extract `collectContentIssues` and add `issuesToFieldErrors` in `modules/viewer/application/content-issues.ts` (design D5). Make `buildViewerPayload` call `collectContentIssues`. Verify:
  - `content-issues.test.ts` covers every issue code, and the `fieldId` and `fieldId.itemIndex` keys with messages that hold no content;
  - `build-viewer-payload.test.ts` passes unmodified.
- [x] 5.2 Add `modules/gifts/infrastructure/mongo-gift-publication-repository.ts` (`findByShareId`; replays read the publication by gift id in `findPublishReplay`). Add `publishDraft` (design D6) and `findPublishedByShareId` to the `GiftRepository` port and `mongo-gift-repository.ts`. Verify `mongo-gift-repository.test.ts` and `mongo-gift-publication-repository.test.ts`, with the mocked database, assert:
  - the gift write filter (`_id`, `ownership.ownerId`, `status: "draft"`, `access.mode: "unlisted"`, `revision`) and its `$set`;
  - the asset `updateMany`:
    - its filter (`giftId`, `status: "ready"`, the per-field `$or`);
    - its `$currentDate: { updatedAt: true }` update, which is a real write and never a `$set` of an existing value;
    - the `assets-changed` abort when `matchedCount` is short;
  - the `stale`, `replayed` and `idempotency-conflict` outcomes;
  - the duplicate-key re-read;
  - the publication document;
  - the idempotency document with every validator-required field: `_id` `gift-publish:{key}`, `scope`, `key`, `actorKey`, `giftId`, `requestFingerprint`, a 24-hour `expiresAt`, `createdAt` and `updatedAt`. `GiftIdempotencyDocument.scope` is widened to `"gift-create" | "gift-publish"`;
  - the lookup filter `{ shareId: { $eq, $type: "string" }, status: "published", "access.mode": "unlisted" }`.
- [x] 5.3 Add `publishGift` and `getStudioGift` to `gift-service.ts`, with the ports `PublishEntitlement`, `GiftArtifactResolver` and `GiftPublicationRepository`, the asset listing, and the new error codes `FORBIDDEN`, `ACCESS_POLICY_UNSUPPORTED`, `TEMPLATE_NOT_EDITABLE` and `TEMPLATE_UNPUBLISHABLE` (design D4 and D10). Verify `gift-service.test.ts` covers every row of the D4 table:
  - "Not signed in", "Not the owner", "Unclaimed anonymous draft", "Flag off for the owner" and "Flag off for a non-owner";
  - "Stale revision", "Already published", "Invalid content", "Asset not ready", "Withdrawn audio track", "Artifact missing", "Unsupported access policy" and "Template version no longer editable";
  - "Owner publishes a complete gift", "Concurrent save loses" and "Asset deleted during publish";
  - "Lost response replayed", "Replay with a different body" and "Retry after a validation failure";
  - `getStudioGift` for a draft, a published gift, another status and no access.
- [x] 5.4 Add `modules/gifts/presentation/publish-route-handler.ts` and `app/api/gifts/[publicId]/publish/route.ts` with the guard order of design D4. Add the `FORBIDDEN`, `ACCESS_POLICY_UNSUPPORTED`, `TEMPLATE_NOT_EDITABLE` and `TEMPLATE_UNPUBLISHABLE` mappings to `gift-route-helpers.ts`, and wire the entitlement and the artifact resolver in `composition/gifts.ts`. Verify `publish-route-handler.test.ts` covers:
  - `201` with a valid `GiftPublicationResponseSchema` body;
  - `400` for a missing key and for `{ "expectedRevision": 3, "shareId": "abc" }`;
  - `401`, `403`, `404` for a malformed id and for a non-owner, and `409` with and without `details`, including each `details.reason` (`ACCESS_POLICY_UNSUPPORTED`, `TEMPLATE_VERSION_NOT_EDITABLE`, `TEMPLATE_VERSION_UNPUBLISHABLE`);
  - `415` for `text/plain`, and `403` for a cross-site `Origin` without charging the rate limit;
  - `429` with `Retry-After`;
  - `500` with a log line holding only the event name and request id.
- [x] 5.5 Extend `scripts/verify-gift-persistence.ts` (`db:verify-gifts`) as `database-schema-management` "Gift persistence verification" specifies, including the inserted `ready` asset, the refused `markDeleting`, an `explain()` of the share-id lookup that shows an `IXSCAN` on `gifts_share_id_unique`, and the cleanup of publications and assets. Verify `corepack pnpm db:verify-gifts` prints `Gift persistence verification completed successfully.` against the local replica set at version `8`, or record that the coordinator ran it.

## 6. Media operations for non-draft gifts

- [x] 6.1 Require a `draft` gift in `findAuthorizedAsset` and `listAssets` of `media-service.ts` (design D7). Verify `media-service.test.ts` and `media-route-handlers.test.ts` cover "Assets of a published gift" (list, read, delete, retry and completion answer `404`, and no URL is signed), and that every existing draft scenario still passes.
- [x] 6.2 Make `MediaAssetRepository.markDeleting(assetId, giftId, now)` transactional with the draft check, returning `deleting`, `gift-not-draft` or `asset-unavailable` (design D7), and update its caller. Verify `mongo-media-repository.test.ts` asserts:
  - the gift read `{ _id, status: "draft" }` and the asset update run in one session;
  - a non-draft gift gives `gift-not-draft` without updating the asset.

  Also verify `media-service.test.ts` and `media-route-handlers.test.ts`:
  - `gift-not-draft` maps to `404` `NOT_FOUND` ("Gift published before the delete reaches the asset"), and `asset-unavailable` still maps to `409`;
  - the existing expectations that assumed a delete for a non-draft gift proceeds or answers `409` are updated. That behavior change is intentional (`media-upload` "Asset deletion").

## 7. Public read service and endpoint

- [x] 7.1 Add `modules/public-gifts/application/public-gift-service.ts` (`isLiveShare`, `openPublicGift`) and `composition/public-gifts.ts`, reusing `composition/viewer.ts` (design D8). Verify `public-gift-service.test.ts` with fake ports covers:
  - "Payload of the snapshot": the publication content is used, not the gift content, and `expectedContentHash` is passed;
  - "Artifact bytes changed" (`artifactUrl` `null`);
  - no `issues` key in the result;
  - "Malformed share id" (no repository call);
  - each of these gives `null` from both `isLiveShare` and `openPublicGift`, so page and endpoint agree:
    - an unknown share id;
    - a gift that is not `published`;
    - "Unsupported access policy fails closed";
    - "Missing publication record";
    - a missing manifest;
  - the repository filter `{ shareId: { $eq, $type: "string" }, status: "published", "access.mode": "unlisted" }` (in `mongo-gift-repository.test.ts`).
- [x] 7.2 Add `modules/public-gifts/presentation/public-gift-route-handler.ts` and `app/api/public-gifts/[shareId]/route.ts` with the order of design D8. Verify `public-gift-route-handler.test.ts` covers:
  - `200` with a body valid under `PublicGiftResponseSchema` and `Cache-Control: no-store`;
  - `404` for a malformed id (without charging the limit), and `404` for an unknown id, with an identical body apart from `requestId`;
  - both counters charged in order (`public-gift-read` with the share id, then `public-gift-read-ip`), and a `429` with `Retry-After` from either one, without calling the service;
  - "Unexpected failure" (`500`, a log line without the share id).
- [x] 7.3 Add a "Publishing and the public Viewer" section to `docs/architecture.md`. It covers:
  - the publish transaction and the write-conflict argument of design D6 and D7;
  - the entitlement port and the flag's Production force-off;
  - the snapshot and artifact pinning;
  - share links as bearer secrets (no application logs, `no-referrer`, `no-store`), and the residual risk of platform request logs, linking to the runbook note of task 4.1 and to Sprint 4 revocation;
  - the public read limits, and why they are keyed per link (CGNAT);
  - the schema `8` rollback note from design "Migration Plan".

  Verify the links resolve and `corepack pnpm format:check` passes.

## 8. Public gift page `/g/{shareId}`

- [x] 8.1 Add `app/g/layout.tsx` (`await connection()`), `app/g/[shareId]/page.tsx` and `app/g/[shareId]/not-found.tsx` as design D9 describes. The page has `force-dynamic`, the generic metadata and `robots` noindex, calls `notFound()` when `isLiveShare` is `false`, and passes only `shareId` to the client. Do not add a `loading.tsx` under `/g`. Verify:
  - `corepack pnpm build` lists `/g/[shareId]` as dynamic, with no static output under `/g`;
  - `content-security-policy.test.ts` still maps `/g/{shareId}` to the nonce policy.
- [x] 8.2 Make two additive edits to `apps/web/next.config.ts`:
  - a `headers()` entry for `/g/:path*` with `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` and `Cache-Control: private, no-store`, placed after the global entry;
  - `/^\/g\//` and `/^\/api\/public-gifts\//` in `logging.incomingRequests.ignore`.

  Verify the config unit test asserts the entry, its order after `/:path*`, and both ignore patterns.

- [x] 8.3 Add `modules/public-gifts/presentation/load-public-gift.ts` and `public-gift-screen.tsx`, which mounts `GiftViewer` with the deferred source and no reporting handlers. Verify:
  - `load-public-gift.test.ts` covers `200` with a valid body, `404`, `429`, an invalid body (with `issues`) and a network error, all but the first throwing, and that the request uses `cache: "no-store"` and `credentials: "omit"`;
  - `public-gift-screen.test.tsx` (no jest-dom matchers) shows the envelope, with no fetch and no gift content before `Mở quà`, and that an asset refresh of the static fallback calls the endpoint once more ("Refresh of expired asset URLs").

## 9. Studio publish step and published panel

- [x] 9.1 Switch `app/studio/[publicId]/page.tsx` on `getStudioGift`, and add `published-panel.tsx` (design D10, `gift-publishing` "Published gift in the Studio"). Verify `published-panel.test.tsx` covers:
  - the heading, the read-only `Đường dẫn món quà` field and `Mở món quà` with `/g/{shareId}`;
  - "Copy the link", and the manual-copy message when `navigator.clipboard.writeText` rejects.

  Also verify `gift-service.test.ts` (task 5.3) covers the page's `getStudioGift` cases.

- [x] 9.2 Add `modules/gifts/presentation/studio/publish-action.ts` (`requestPublish`). Verify `publish-action.test.ts` covers:
  - `flush` results `saved`, `offline`, `invalid`, `conflict` and `failed`: only `saved` sends a request;
  - the request carries `Content-Type: application/json`, the given `Idempotency-Key` and `{ expectedRevision }` equal to the flushed revision;
  - `201` valid → `published`, and `201` invalid → `failed`;
  - `400` → `invalid` with `fieldErrors`, `401` → `unauthenticated`, `403` → `forbidden`, `404` → `gone`;
  - `409` responses:
    - with `actualRevision` → `conflict`;
    - with `TEMPLATE_VERSION_UNPUBLISHABLE` or `TEMPLATE_VERSION_NOT_EDITABLE` → `unpublishable`;
    - with `ACCESS_POLICY_UNSUPPORTED` → `access-unsupported`;
    - without `details` → `reload`;
  - `429` → `rate-limited` with `retryAfterSeconds`, and `500` or a rejected fetch → `failed`.
- [x] 9.3 Add `publish-step.tsx` and render it from the `publish` step of `readiness-step.tsx`, replacing the disabled `Sắp ra mắt` button. Pass `publishEnabled`, `signedIn` and `ownerKind` from the page. Keep one `Idempotency-Key` per mounted Studio. On `published`, dispose the autosave controller and show `PublishedPanel`. Verify `publish-step.test.tsx` covers the `studio-editor` scenarios:
  - "Anonymous draft must be claimed", "Signed in with an unclaimed draft", "Publishing not enabled" and "Incomplete steps block publishing";
  - "Publish after a pending change", "Publish rejected content" (the `Sửa` link and the inline error), "Publish request fails" (the same key twice), "Double click on publish" and "Gift published in another tab";
  - "Template version cannot be published" (no reload), and the `401`, `403`, `429`, unpublishable and access-policy messages;
  - the preview scenarios in `readiness-step.test.tsx` still pass (including "Back from the preview"), and "Action not yet available" now asserts the disabled `Xuất bản` button with `Xuất bản chưa được mở cho tài khoản này.` when the entitlement is off.

## 10. End-to-end journey (run by the coordinator)

- [x] 10.1 Add `INTERNAL_PUBLISH_ENABLED: "true"` to the Playwright web server `env` in `playwright.config.ts`. Add `apps/web/e2e/publish.spec.ts` on the local object storage of `add-local-object-storage`. Put its helpers in `apps/web/e2e/support/` so that `add-funnel-analytics` can extend this spec instead of writing a second journey (design D14):
  - a sign-in helper that reads the magic link from `AUTH_EMAIL_CAPTURE_PATH`;
  - a unique e-mail per Playwright project and run, for example `publish-${testInfo.project.name}-${Date.now()}@example.test`, so parallel projects never share an account or a captured link.

  The journey:
  1. As a visitor, create a `memory-box@1.1.0` draft. Fill every required field, including `final-letter` with the text `Gửi em lá thư cuối`. Upload 3 committed JPEG fixtures with captions (one `Đà Lạt 2023 🌲`) and wait for `Đã lưu`.
  2. Open `Xem trước` and assert the issues panel shows `Không phát hiện vấn đề nào.`. Go back to the Studio.
  3. Open step `Xuất bản`. Assert that `Xuất bản` is disabled with `Đăng nhập và lưu quà vào tài khoản để xuất bản.`.
  4. Sign in through the magic link, return to the Studio and claim the draft. Assert that `Xuất bản` becomes enabled.
  5. Start `page.waitForRequest` for `POST **/publish`, then choose `Xuất bản`. Capture the request's `Idempotency-Key` header and body. Assert that `Đã xuất bản` and a share URL matching `/g/[A-Za-z0-9_-]{22}$` appear, then reload and assert that the panel persists.
  6. From inside the page (`page.evaluate(fetch)`, same origin, so the browser sends the owner's cookies and `Origin`; the draft cookie is `Secure`, which Playwright's request context does not send to `http://127.0.0.1`), send the captured key and body again with `Content-Type: application/json`, and get `201` with the same `shareId`. Send the same key with another `expectedRevision` and get `409`.
  7. The same way, assert that `GET /api/gifts/{publicId}` answers `404`, and that `DELETE /api/media/assets/{assetId}` for one photo (its id read from the asset list before publishing) answers `404`.
  8. In a fresh browser context without cookies, open the share URL. Assert:
     - the response headers: `Cache-Control` with `private` and `no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, and a CSP with `'strict-dynamic'`;
     - the title `Một món quà dành cho bạn · LoveMemory`;
     - that the HTML contains no caption, letter text or recipient name;
     - that no `/api/public-gifts/` request happened before the tap.
  9. Choose `Mở quà` and press `Tiếp` until `memory-1`. Assert the photo inside the iframe has `naturalWidth > 0` and `Đà Lạt 2023 🌲` is visible. Attach screenshots.
  10. Gate M2, "Template lỗi không làm mất nội dung cốt lõi". In another fresh context:
      1. Call `page.route('**/template-artifacts/**', (route) => route.abort())` and open the share URL.
      2. Choose `Mở quà` and wait for the static fallback.
      3. Assert that the region `Nội dung món quà` shows `Đà Lạt 2023 🌲` and `Gửi em lá thư cuối`, and a photo with `naturalWidth > 0`.
      4. Attach a screenshot.
  11. Assert that `/g/` followed by 22 random characters renders `Món quà không tồn tại hoặc đã được thu hồi.` with `X-Robots-Tag: noindex`, and that `GET /api/public-gifts/{random}` answers `404`.

  Verify it passes on `chromium` and `mobile-chromium` against the production build. The coordinator runs it after merging; never run it inside a worktree.

## 11. Verification and archive

- [x] 11.1 Run `corepack pnpm verify:local` and confirm it passes: secrets, spec:check, format, lint, types, coverage (including per-file thresholds for the new `.ts` files), audit, build, and installed-Chrome E2E including `publish.spec.ts`. Record any step that cannot run locally and why.
- [x] 11.2 Re-run the design D13 re-diff once more immediately before archiving, in case another change was archived meanwhile. Verify `corepack pnpm -s openspec validate add-temporary-gift-publish --strict` passes.
- [x] 11.3 Archive the change with `/opsx:archive add-temporary-gift-publish` in the same PR, and remove both of this change's `modifiedBodyDrop` waivers from `openspec/gate-exceptions.json`. Verify `corepack pnpm spec:check` passes afterwards.

## Out of scope

- Payment, orders and real entitlements replacing `INTERNAL_PUBLISH_ENABLED` (Sprint 4–5, ADR-0009).
- QR codes, Web Share and printable share cards (plan.md §13.3).
- Password and scheduled access, pause/resume, expiry, revocation and deletion of published gifts (plan.md §13.1–13.2, Sprint 6 deletion). A share link cannot be revoked in this change, and gifts with a non-`unlisted` access policy fail closed.
- Removing share ids from hosting platform request logs. The residual risk is documented (task 4.1), and revocation in Sprint 4 is the fix.
- Re-publishing edits as a new revision, and editing a published gift.
- A publish outbox, background retries and a persisted `publishing` state.
- An owner dashboard or a list of published gifts.
- Funnel events `publish_clicked`, `gift_published`, `gift_open_interaction`, `scene_completed` and `gift_completed`, plus the visual snapshots, edge cases and performance baseline that `add-funnel-analytics` adds to `publish.spec.ts` (see design D14).
- Social preview images and bot classification for share links.
- A real `404` HTTP status for unknown share links, which would need a proxy database lookup or removing the root `loading.tsx`.
- Rate limiting the `/g/{shareId}` page render itself (one indexed read per valid-format request, see design D8).
