# Tasks

## 1. Gift viewer runtime outcome

- [x] 1.1 Add `onRuntimeSettled` to `createGiftViewerController` (once per controller: first
      `READY` or any fallback, `NO_ARTIFACT` deferred and dropped after dispose) and the
      `GiftViewer` prop, with controller tests: repeated `READY` notifies once, handshake timeout
      notifies `fallback` once, `NO_ARTIFACT` notifies after mount, dispose before `READY` notifies
      nothing

## 2. Preview restart decision and feedback

- [x] 2.1 Add `presentation/preview-restart.ts` (`RESTART_URL_MARGIN_MS`, `chooseRestartMode`) with
      unit tests: `null` expiry, more than / exactly / less than 60 s left, past and unparsable
      timestamps
- [x] 2.2 Restart in `PreviewScreen` on the client when the mode is `client` and inside
      `useTransition` + `router.refresh()` otherwise, with component tests: client restart remounts
      with the same payload and no refresh; near-expiry restart refreshes and remounts on arrival;
      the reduced-motion toggle follows the same rule
- [x] 2.3 Render the pending state (busy label with spinner, `aria-busy`/`aria-disabled`, other
      restart control disabled, viewport buttons enabled, frame overlay with polite status, `inert`
      viewer) cleared only by the current generation's runtime outcome, with component tests:
      busy until `ready`, busy until `fallback`, an old mount's outcome ignored, repeated presses
      restart once
- [x] 2.4 End the pending state with `Chưa tải lại được bản xem trước. Hãy thử lại.` when the
      transition ends without a new payload, with a component test
- [x] 2.5 Show the static-fallback notice under the frame for `ERROR`/`INIT_TIMEOUT`/
      `LOAD_TIMEOUT` (not `NO_ARTIFACT`) and reset it on restart, with component tests

## 3. End-to-end

- [x] 3.1 Extend `apps/web/e2e/preview.spec.ts`: a fast `Phát lại` sends no preview document/RSC
      request, shows `Đang phát lại…` with `aria-busy="true"` and the overlay, clears them, and
      after `Mở quà` the animated `memory-1` plays with no static region; `Giảm chuyển động` shows
      `Đang áp dụng…` and the next run has `data-motion="reduced"`; a near-expiry restart (page
      clock moved forward) re-reads the draft while the busy state is held, then clears

## 4. Operations documentation

- [x] 4.1 Document in `docs/runbooks/preview-deploy-and-rollback.md` that Vercel Deployment
      Protection breaks sandboxed template artifacts (symptom, `curl` check, options), and update
      the `docs/risk-register.md` staging-access row accordingly; verify with `pnpm format:check`

## 5. Verification and archive

- [x] 5.1 Run the narrow Vitest suites, `pnpm test:e2e` and `pnpm test:e2e:chrome`
- [x] 5.2 Run `pnpm verify:local`
- [x] 5.3 Archive this change in the same PR and confirm `node --import tsx scripts/check-openspec.ts`
      passes

## Out of scope

- Changing the Vercel Deployment Protection setting of `dev`/`stg` (operator decision, P4)
- Serving template artifacts from a separate unprotected origin
- Background refresh of the held draft content so a fast restart shows edits from another tab
