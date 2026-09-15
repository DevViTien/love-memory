# Browser support baseline

- Status: accepted with a temporary Sprint 0 risk exception
- Current execution environment: Windows + installed Chrome 153
- Automated CI browser: Playwright Chromium desktop and Pixel 7 emulation

## Entry gate for Sprint 1

Chrome on Windows is the active development baseline. Every pull request must pass the production
Playwright suite on desktop and mobile viewport projects. A local installed-Chrome run is available
through `pnpm test:e2e:chrome`.

Supported behavior in this baseline:

- catalog/detail navigation;
- nonce/static/template CSP modes without browser console errors;
- sandbox iframe INIT/PLAY/PAUSE/DESTROY/reload lifecycle;
- upload-lab UI and hidden mutation endpoints by default;
- audio play Promise fallback through unit tests and the manual lab;
- liveness contract.

## Deferred device matrix

Before Template 1 is considered Viewer-ready, test on:

- current and oldest-supported Safari iOS device;
- Chrome Android on a mid-tier physical device;
- target Zalo/Messenger/Facebook in-app browsers;
- Edge and Firefox desktop;
- Safari macOS when available.

Emulation is not accepted as evidence for audio/autoplay, memory pressure, browser chrome viewport,
WebView lifecycle or QR handoff. Results are recorded in `mobile-audio-checklist.md`.

## Temporary risk acceptance

The Product Owner explicitly requested Chrome/Windows-first verification. This is sufficient to
start Sprint 1 domain/database/auth work because those stories do not ship the final Viewer.
Cross-browser work remains a blocking gate before Sprint 2 Viewer runtime exits and before any
external pilot. A browser failure must receive either a fix or a documented static/audio fallback.
