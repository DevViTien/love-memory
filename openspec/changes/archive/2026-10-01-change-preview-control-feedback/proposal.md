# Proposal

## Why

On the deployed `dev` environment, pressing `Phát lại` or `Giảm chuyển động` on `/preview/{token}`
re-renders the whole page on the server (re-reading the draft and re-signing 300-second image URLs)
with no visible feedback at all, so the controls feel broken and invite repeated clicks. The same
report showed the frame as a vertical list of photos captioned `Ảnh 2`: that is the host's static
fallback, not the Memory Box animation. Investigation found that the restart itself does not cause
it (restart and reduced-motion runs reach the animated template locally). The `dev` deployment is
behind Vercel Deployment Protection: every request without the Vercel SSO cookie is redirected to
`vercel.com/sso-api`. The template iframe runs with `sandbox="allow-scripts"` (opaque origin), so
its `runtime.mjs` module request is credential-less and gets that redirect, the runtime never
starts, no `READY` arrives and the gift viewer falls back after the `INIT` handshake times out, on
every open. The fallback is intended behavior; the preview just never said so near the frame.
This is a Sprint 3 / Gate M2 follow-up (plan.md §12): the preview is part of the vertical-slice demo.

## What Changes

- **Pending feedback**: the pressed control shows a spinner and `Đang phát lại…` or
  `Đang áp dụng…`, exposes `aria-busy="true"` and ignores further presses; the other restart
  control is disabled; the frame shows a polite status overlay `Đang tải lại bản xem trước…` until
  the new gift viewer's runtime is ready or has fallen back. Labels and overlay never change the
  layout. Viewport buttons stay enabled and instant.
- **Faster restart**: when the held asset URLs are valid for more than 60 seconds (or there are
  none), `Phát lại` and `Giảm chuyển động` restart on the client: the gift viewer is remounted with
  the payload the page already holds (`DESTROY` to the old template, a new iframe, a new `INIT`),
  with no server request. Otherwise the page re-reads the draft as today, inside a React transition
  whose pending state drives the feedback. **Behavior change**: a fast restart replays the content
  the page holds; content saved in another tab appears after a page reload, a new preview link, or a
  restart close to URL expiry.
- **Readiness notification**: the gift viewer tells its host page once per mount whether its
  runtime became ready or fell back, so the preview knows when to clear the overlay.
- **Failure feedback**: a server re-read that ends without a new payload clears the busy state and
  shows `Chưa tải lại được bản xem trước. Hãy thử lại.`.
- **Visible fallback**: when the template fails (error or timeout), the preview shows
  `Đang hiển thị bản tĩnh vì mẫu quà không chạy được. Người nhận vẫn thấy đầy đủ nội dung.` right
  under the frame, in addition to the issues panel notice.
- **Operations**: the deployment runbook and risk register record that Vercel Deployment Protection
  (Vercel Authentication) breaks sandboxed template artifacts, so `dev`/`stg` must use another access
  control (or the protection must be disabled) before the Gate M2 demo.

## Non-goals

- Changing Vercel project settings (an operator task; the runbook states it).
- Serving template artifacts from a separate unprotected origin or changing the immutable
  `memory-box@1.1.0` artifact.
- Refreshing the held draft content in the background (focus/visibility polling).
- Pending feedback for the gift viewer's own controls (`Mở quà`, mute), which do no server work.
- Changing the published Viewer page (`/g/{shareId}`) or recipient analytics.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gift-preview`: restart and reduced-motion controls restart on the client while asset URLs are
  valid, show pending feedback and a loading overlay, report a failed re-read, and the page names
  the static fallback near the frame.
- `gift-viewer`: notifies its host page once per mount that the runtime is ready or has fallen
  back.

## Invariants touched

- Template code runs in `sandbox="allow-scripts"` and the host accepts only schema-valid messages
  from that exact iframe: unchanged; a client restart creates a new iframe and a new bridge bound to
  it, and the old one receives `DESTROY` first.
- Audio never autoplays: unchanged; a restart shows the envelope again, and playback still starts
  only inside `Mở quà`. `PLAY` is still sent only after `READY`.
- Short-lived signed URLs: a client restart reuses URLs only while they stay valid for more than 60
  seconds; otherwise fresh URLs are signed by the server as before. No URL is logged.
- Protected gift payloads never enter public caches; private routes use nonce CSP: unchanged, no
  new route, the page stays dynamic and `private, no-store`.
- Reduced-motion and no-audio paths always exist: unchanged; the toggle still forces
  `prefersReducedMotion`.

## Impact

- Code: `apps/web/src/modules/preview/presentation/preview-screen.tsx`, new
  `presentation/preview-restart.ts`, `apps/web/src/modules/viewer/presentation/gift-viewer.tsx`,
  `gift-viewer-controller.ts`, their tests, `apps/web/e2e/preview.spec.ts`.
- Docs: `docs/runbooks/preview-deploy-and-rollback.md`, `docs/risk-register.md`.
- No route, schema, environment variable, dependency or migration change.
