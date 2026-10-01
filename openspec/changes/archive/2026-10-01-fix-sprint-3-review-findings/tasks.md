# Tasks

## 1. Catalog availability (A1)

- [x] 1.1 Add `available` to `TemplateSummary`, take an `isAvailable` port in the templates
      application functions, wire it to the artifact registry in `composition/templates.ts`; verify
      with application tests for available and unavailable versions
- [x] 1.2 Show the `Sắp ra mắt` badge on cards, replace the detail page call to action with the
      `Sắp ra mắt` explanation, and refuse `/studio/new` for unavailable templates; verify with
      view-model tests and the home/catalog E2E
- [x] 1.3 Refuse `GiftService.createDraft` with `NOT_FOUND` when no artifact is registered; verify
      with a gift-service test
- [x] 1.4 Pass `publishable` to the Studio, show the template-version notice and disable `Xuất bản`
      with `Phiên bản mẫu của món quà này không hỗ trợ xuất bản.`; verify with Studio component
      tests

## 2. Sign-in handoff (A2)

- [x] 2.1 Claim an anonymous draft automatically in the Studio page when a signed-in viewer presents
      its anonymous cookie; verify with the publish E2E (no separate claim step) and a page-level
      service test of the claim path
- [x] 2.2 Add the static Studio not-found page with the recovery guidance; verify with an E2E that
      opens an unknown Studio URL
- [x] 2.3 Add the same-browser sentence to the sign-in confirmation; verify with a component test
- [x] 2.4 Add the cross-browser magic-link risk to `docs/risk-register.md`

## 3. Publish safety and read-only editor (A3, A6, A18 read-only)

- [x] 3.1 Add `publishing` to the editor store, ignore `setFieldValue` while publishing or read-only,
      and stop the leave warning when read-only; verify with store tests
- [x] 3.2 Disable text, date, choice and image-field controls while publishing or read-only; verify
      with Studio component tests (typing while publishing, non-editable alert)
- [x] 3.3 Add the publish confirmation (`Xác nhận xuất bản` / `Quay lại chỉnh sửa`), report
      `publish_clicked` on `Xuất bản`, and freeze the editor during the request; verify with
      publish-step tests and update every E2E that publishes

## 4. Request timeouts (A4) and autosave edge (A10)

- [x] 4.1 Add `fetchWithTimeout` and use it for save (15 s), draft reload (15 s), preview (15 s) and
      publish (30 s); verify with request tests driven by fake timers
- [x] 4.2 Schedule the rate-limit retry and show `Chưa lưu được — thử lại` when a flush runs inside a
      `429` window; verify with an autosave-controller test

## 5. Image field (A5, A11, A17)

- [x] 5.1 Show Vietnamese status labels and `Ảnh {n}` instead of raw statuses and asset IDs, and
      remove template jargon from the field copy; verify with component tests
- [x] 5.2 Guard every request and report after unmount, key polling on a pending flag, make
      `refreshPending` single-flight, and show messages for failed delete and retry; verify with
      component tests (unmount during grant, delete failure, retry failure)
- [x] 5.3 Add 15 s timeouts to grant and completion requests, a 30 s stall timer to the transfer, and
      delete the asset when a transfer is interrupted; verify with component tests
- [x] 5.4 Label theme options with Vietnamese names and name the default; verify with a Studio field
      test

## 6. Server fixes (A7, A8, A9, A13, A14, A15)

- [x] 6.1 Prune `giftRevisions` to the 20 most recent in the save transaction; verify with a
      repository test, and document the retention in the architecture data inventory
- [x] 6.2 Retry the rate-limit upsert once on duplicate key without upsert; verify with limiter
      tests
- [x] 6.3 Trust `x-vercel-forwarded-for` only when `VERCEL` is `1`; verify with a regression test
- [x] 6.4 Cap publish and preview bodies at 1 KiB and draft saves at 64 KiB, and log route failures
      with `reportOperationalFailure`; verify with route handler tests
- [x] 6.5 Read public payload assets by the publication snapshot ids; verify with public-gift-service
      tests
- [x] 6.6 Skip malformed captioned items in `listImageFieldReferences`; verify with a template-sdk
      test

## 7. Gift viewer and analytics (A12, A16)

- [x] 7.1 Create the iframe with its artifact URL, mark the triggering image failed when the asset
      refresh fails, and resume audio after `COMPLETE` when the page is visible again; verify with
      controller and component tests
- [x] 7.2 Move focus to `Đang mở quà…`, `Tiếp tục` and `Thử lại`; verify with component tests
- [x] 7.3 Ignore a repeated scene notice in the recipient reporter; verify with a reporter test

## 8. Not-found status (A21)

- [x] 8.1 Move the home page and the root loading UI into `app/(home)/` and assert `404` for unknown
      `/g` and `/preview` links in E2E; update the not-found note in `docs/architecture.md`

## 9. Hygiene and tests (A18, A19, A23)

- [x] 9.1 Return the same content object for no-op field changes; verify with a validation test
- [x] 9.2 Add `getGiftRequestContextFromHeaders`, fold the duplicated `requestId` and `429` helpers,
      and fix the stale viewer-payload comment; verify with type-check and the route tests
- [x] 9.3 Add the ESLint guard against presentation→infrastructure imports with the explicit
      allowlist; verify `pnpm lint` passes and a new violating import fails
- [x] 9.4 Isolate the publish revision compare-and-set in `scripts/verify-gift-persistence.ts`;
      verify with `pnpm db:verify-gifts` against the local replica set

## 10. Documentation

- [x] 10.1 Write `docs/sprints/sprint-3-review.md`: the review summary, the disposition of every
      finding, the PO decision table, the Gate M2 checklist with the QA staging charter, and the
      Sprint 4 debt list
- [x] 10.2 Update `docs/sprints/sprint-3-results.md` with evidence re-run at the final HEAD (QA-D-9)

## 11. Verification and archive

- [x] 11.1 Run the narrow Vitest suites, `pnpm test:e2e` and `pnpm test:e2e:chrome`
- [x] 11.2 Run `pnpm verify:local`
- [x] 11.3 Archive this change in the same PR, then confirm `pnpm spec:check` passes

## Out of scope

- Moving the rate limiter out of the gifts module and composing route rate limits (A19 remainder,
  Sprint 4).
- Rate limits on the `/g` and `/preview` page renders (A15 remainder).
- A per-tab analytics session that survives "Duplicate tab" (A20).
- The `gifts` validator `anyOf` for published gifts, the migration downgrade guard and the
  index-rebuild window (A18 validator, DEV-m9).
- A publish replay lookup by `{ giftId, revision }` (A18, with the re-publish design).
- Re-INIT on a second iframe load (DEV-NIT1, rejected), and folding the release byte duplication
  and the build-script hash (rejected).
- A runtime-error fallback E2E, an injectable autosave timer seam for the Studio component tests,
  and the other Sprint 4 test debt in `docs/sprints/sprint-3-review.md`.
- Every Product Owner decision of Bucket B.
