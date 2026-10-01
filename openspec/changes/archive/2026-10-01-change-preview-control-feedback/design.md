# Design

## Context

`PreviewScreen` (`apps/web/src/modules/preview/presentation/preview-screen.tsx`) restarts by
calling `router.refresh()` and remounting `GiftViewer` (via a `key`) once the refreshed `viewer`
prop arrives. Nothing is rendered between the press and the new payload, and nothing tells the page
when the new template is ready. `GiftViewer` keeps the runtime state (`idle | loading | ready |
fallback`) inside `gift-viewer-controller.ts` and only reports lifecycle notifications that are
tied to the person (`opened`, `scene`, `completed`, `fallback`).

The `dev` deployment answers every request without the Vercel SSO cookie with a `302` to
`vercel.com/sso-api` (checked with `curl` on the artifact `index.html` and `runtime.mjs`). The
template document is sandboxed without `allow-same-origin` (ADR-0004), so its
`<script type="module" src="runtime.mjs">` request is a CORS request from an opaque origin with
credentials mode `same-origin`: no cookie is sent, the redirect is cross-origin, the module fails
and no `READY` ever arrives. The gift viewer then falls back after 20 `INIT` attempts, which is
the screenshot. Locally (production build, no protection) restart, reduced-motion on/off and
double restarts all reach the animated template.

## Goals / Non-Goals

**Goals:**

- Feedback within the same frame as the press, cleared by a real signal (runtime settled), never by
  a timer.
- No server round trip for a restart while the held signed URLs stay usable.
- Keep the sandbox, protocol, gesture and `PLAY`-after-`READY` rules untouched.

**Non-Goals:**

- Making template artifacts work behind Vercel Deployment Protection (needs an unprotected artifact
  origin or a settings change; recorded in the runbook and the risk register).
- A generic loading system for other pages.

## Decisions

### D1. Restart mode decided from `assetsExpireAt`

`chooseRestartMode(viewer, nowMs)` in `presentation/preview-restart.ts` returns `client` when
`assetsExpireAt` is `null` or more than `RESTART_URL_MARGIN_MS` (60 000 ms) after `nowMs`, else
`server`. An unparsable timestamp is treated as expired (`server`). 60 seconds covers the
handshake budget (load ≤ 15 s + 20 × 250 ms) plus the first scenes, so photos requested after the
restart do not hit an expired URL; if one does, the existing asset-refresh path still applies.

Alternatives: always client (stale URLs would break photos in the template, which has no refresh
path); always server (the slow path the report is about); a background refresh after a client
restart to pick up new content (a second remount or a content swap mid-play; rejected, see
proposal Non-goals).

### D2. Client restart = remount with the held payload

The client path bumps the `GiftViewer` `key` with the latest `viewer` prop the page holds (which
may already carry URLs refreshed through `onAssetsExpired`) and the new `forceReducedMotion`.
Unmounting disposes the old controller, which sends `DESTROY` and stops listening to the old
window; the new mount creates a new iframe and bridge, so the exact-source rule and the
handshake budget start fresh. No new protocol message is needed.

### D3. Server restart inside `useTransition`

`startTransition(() => router.refresh())` (Next.js 16 `useRouter`, see
`node_modules/next/dist/docs/01-app/02-guides/interactive-apps.md`) gives `isPending` until the
refreshed RSC payload commits. The existing render-time "new `viewer` prop + pending restart ⇒
remount" logic stays. If the transition ends while the restart request is still pending (no new
`viewer` object arrived), an effect ends the pending state and shows
`Chưa tải lại được bản xem trước. Hãy thử lại.`. A hard error (expired link) renders the
not-found page as before. The asset-refresh path (`onAssetsExpired`) keeps calling
`router.refresh()` outside the transition so it never shows restart feedback.

### D4. Pending state keyed by generation

`PreviewScreen` holds `busy: { action, generation | null }`. `generation` is set when the remount
happens (immediately for the client path, at payload arrival for the server path), and
`GiftViewer`'s new `onRuntimeSettled` callback clears `busy` only for that generation. A late
outcome from the previous mount (for example the old viewer reaching `READY` while a server
re-read runs) therefore cannot clear the feedback early. Presses while `busy` are ignored, which
gives "restart once, at most one re-read".

### D5. Runtime outcome from the controller

`createGiftViewerController` accepts `onRuntimeSettled?: (outcome: "ready" | "fallback") => void`
and calls it once per controller: on the first `READY`, or inside `switchToFallback` (deferred to
a microtask together with the `NO_ARTIFACT` lifecycle notification, guarded by `disposed`, so a
Strict Mode double mount reports once). It is a separate callback, not a new
`ViewerLifecycleEvent`, so the public page and the recipient analytics reporter are unaffected.

### D6. Accessible, layout-stable feedback

- The pressed button keeps focus: it uses `aria-disabled="true"` + `aria-busy="true"` and a
  guarded handler instead of `disabled` (a disabled focused button drops focus to `body`). The
  other restart button uses `disabled`. Viewport buttons stay enabled.
- Labels are stacked in one CSS grid cell (idle and busy label both rendered, the inactive one
  `invisible` and `aria-hidden`), so the button width never changes. The spinner
  (`motion-safe:animate-spin`) is rendered only while busy; idle, a static box of the same size
  holds its place. An always-mounted hidden spinner keeps animating, and on installed Chrome that
  constant repaint made clicks inside the sandboxed template frame (`Tiếp`) get lost.
- The visual overlay (`aria-hidden`, absolutely positioned inside the frame, no layout impact) is
  rendered only while busy, so no idle layer ever sits over the template frame. The announcement
  comes from an always-present visually hidden `role="status"` `aria-live="polite"` element
  under the frame, whose text is set while busy (a live region inserted together with its text is
  not announced reliably).
  The gift viewer wrapper gets `inert` while busy so the envelope cannot be tapped or focused
  under the overlay.
- `router.refresh()` keeps scroll position (Next.js docs); the client path never navigates.

### D7. Fallback made explicit

When `fallbackReason` is `ERROR`, `INIT_TIMEOUT` or `LOAD_TIMEOUT`, a notice is rendered directly
under the frame (`role="status"`), in addition to the existing issues-panel line. `NO_ARTIFACT`
keeps its own notice above the controls. Both reset on restart.

### Security, data, CSP and caching

No route, schema, index, environment variable or CSP change. The page stays nonce-CSP,
`connection()`-dynamic and `private, no-store`. A client restart only reuses data already in the
browser; no signed URL or gift text is logged.

## Risks / Trade-offs

- [A fast restart shows content saved after the page loaded only after a reload or near URL
  expiry] → stated in the spec and proposal; the Studio's `Xem trước` always opens a fresh page.
- [The preview link may have expired while a fast restart still works] → the restart only replays
  data the browser already has; any server read still checks the token.
- [The template never settles] → the controller's 15 s load and 20-attempt handshake timeouts
  always end in `fallback`, which clears the pending state.
- [`dev` keeps falling back while Deployment Protection is on] → runbook + risk register entry; the
  operator decides (disable protection on `dev`/`stg` or use an application-level allowlist).

## Migration Plan

None. Rollback is a revert of the commit; no data is written.
