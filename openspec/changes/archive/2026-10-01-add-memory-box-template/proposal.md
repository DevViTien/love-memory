# Proposal

## Why

Gate M2 (plan.md §12.3) needs a real "Hộp ký ức" that a recipient can open on a phone. Today the
catalog seeds `memory-box@1.0.0`, but that is a placeholder manifest with no artifact behind it. The
only runnable template is `memory-box-spike@0.1.0`, an isolation spike that shows a name and some
thumbnails and then completes after 700 ms.

The previous change (`change-template-contract-for-studio`) agreed the v1.1 input contract:
captioned photos, steps and a narrowed `audio` value. This change ships the template that uses it,
as one immutable release, `memory-box@1.1.0`: the manifest, the built artifact and the seed record
together. Preview (`add-gift-preview`) and publish (`add-temporary-gift-publish`) cannot start
until a real artifact exists for the version that new drafts pin.

## What Changes

- Add the template workspace `templates/memory-box` (package `@love-memory/template-memory-box`),
  which builds the artifact `memory-box@1.1.0` with `engineVersion` `1.0.0`:
  - fields and steps exactly as in the input contract of `docs/templates/memory-box-storyboard.md`;
  - scenes: a cover (closed box) before `PLAY`, then `opening`, one memory card per photo
    (`memory-1` … `memory-n`) with its caption and an in-frame `Tiếp` button or timer,
    `letter` and `finale`, then `COMPLETE`;
  - the theme variants `rose-night` (default) and `warm-paper`, a reduced-motion path, a text card
    that replaces a missing or broken photo, and a static readable fallback with `ERROR`
    `RUNTIME_ERROR` when the runtime fails;
  - one self-contained runtime module of at most 60 KiB gzip, with no network or media APIs. Audio
    stays with the host.
- Add one optional, additive template→host event `ISSUE` to protocol version `1`:
  `{ protocolVersion: 1, type: "ISSUE", code: "ASSET_UNAVAILABLE" | "CONTENT_MISSING", fieldId,
itemIndex? }`. The host validates it like every other event: strict schema and the exact iframe
  source. The Viewer harness logs and counts issues without changing its status. Preview turns
  issues into `Sửa` links later.
- Commit the released bytes of `memory-box@1.1.0` under `templates/memory-box/releases/1.1.0/`.
  The web artifact registry serves released versions only from these committed files, never
  from a rebuild. Tests pin each release's `contentHash` and the SHA-256 of every release file, so
  later source or toolchain changes can only produce a new version and never alter what
  published gifts run. `build:templates` builds every template workspace instead of only the
  spike.
- Make the host `PLAY` contract explicit: a production host sends `PLAY` only after `READY`.
  Memory Box holds an early `PLAY` instead of answering `ERROR`, because the later `GiftViewer`
  treats `ERROR` as a switch to its static fallback.
- Let harness fixtures supply asset URLs, sent as `INIT` `assets`. Memory Box ships the fixtures
  `default`, `max-length`, `missing-fields` and `broken-image`, with inline `data:` images, so the
  harness can show real photos without uploads. The harness counts distinct issues, so an `INIT`
  resent during the handshake does not inflate the count. In the mobile viewport the harness frames the
  iframe in portrait.
- Seed `memory-box` with `currentVersion` `1.1.0`. The manifest and preview fixture are imported
  from the committed release, so they have one source of truth. `memory-box@1.0.0` stays stored,
  byte-identical, with status `retired`. `our-timeline` and `midnight-wish` stay at `1.0.0`. The
  seed never rewrites a stored release. It refuses to run when a stored manifest's content differs
  from the seed's, using a key-order-independent canonical comparison.
- Capture Playwright screenshots of the key scenes of every fixture through the Viewer harness, as
  the visual release fixtures that ADR-0004 requires.
- Point the E2E and runbook references that create `memory-box@1.0.0` drafts at `1.1.0`, because a
  retired version cannot be used to create new drafts.

This change belongs to **Sprint 3, Gate M2**. It is the first of the Sprint 3 changes still open,
and is archived in this order:

1. `add-memory-box-template` (this change)
2. `add-schema-driven-studio`
3. `add-local-object-storage`
4. `add-gift-preview`
5. `add-temporary-gift-publish`
6. `add-funnel-analytics`

## Non-goals

- The host's envelope, tap-to-open control, audio playback UI (play, mute, replay), pause-on-hidden
  UX, and the host-rendered static fallback on `ERROR` or `INIT` timeout. These belong to the shared
  `GiftViewer` in `add-gift-preview`. The Viewer harness keeps its `Phát` button as the gesture.
- The preview route, preview tokens, the issues panel and `Sửa` links (`add-gift-preview`).
- Building Viewer payloads from stored drafts: signed asset URLs and audio URLs
  (`add-gift-preview`).
- Publishing, share links and the public Viewer (`add-temporary-gift-publish`).
- Analytics events for scenes (`add-funnel-analytics`).
- An artifact for `memory-box@1.0.0`. It never had one, and it stays retired. Previewing a draft
  pinned to it is decided by `add-gift-preview`.
- Templates 2 and 3 (`our-timeline`, `midnight-wish`). They stay placeholder manifests at `1.0.0`
  until Gate M2 passes.
- Removing `memory-box-spike`. It stays the reference template of `template-viewer-runtime`.
- Pixel-diff screenshot baselines. Screenshots are attached for review, and layout is asserted in
  code (see design D9).
- Real licensed audio tracks. The catalog may still be empty, and `audio` stays optional.

## Capabilities

### New Capabilities

- `memory-box-template`: the "Hộp ký ức" `1.1.0` release. It covers:
  - the manifest (identity, fields, steps, budgets);
  - the artifact constraints;
  - the cover and initialization;
  - the scene sequence and controls;
  - memory cards and image fallback;
  - content issues;
  - themes, reduced motion and the runtime-error fallback;
  - accessibility and text layout;
  - the harness fixtures.

### Modified Capabilities

- `template-viewer-runtime`:
  - the protocol gains the optional `ISSUE` event;
  - the lifecycle status ignores `ISSUE`, production hosts send `PLAY` only after `READY`, and
    a template may hold an early `PLAY` instead of answering `ERROR`;
  - the Viewer harness sends fixture asset URLs, shows a count of distinct issues and frames the
    mobile viewport in portrait.
- `template-artifact-delivery`:
  - `memory-box` `1.1.0` becomes an available artifact;
  - released versions are served from committed, hash-pinned release files (new requirement
    "Committed template releases");
  - `build:templates` builds every template workspace, and each runtime module is
    self-contained.
- `template-catalog`: the seeded launch templates put `memory-box` at `1.1.0`, keep `1.0.0` as
  `retired`, and refuse to rewrite a stored release.
- `database-schema-management`: the template catalog seed stores `memory-box@1.1.0` and the
  retired `memory-box@1.0.0`, and guards release immutability.

## Impact

- **Invariants touched**:
  - _A template release is immutable once referenced_: `1.1.0` is a new release.
    `memory-box@1.0.0` keeps its exact manifest and preview fixture, and only its registry status
    changes to `retired`. The seed aborts instead of rewriting a stored release. Released artifact
    bytes are committed and hash-pinned, so a toolchain upgrade cannot change them.
  - _Template code runs in `sandbox="allow-scripts"` with no network access; the host accepts only
    schema-valid messages from that exact iframe_: the new template runs under the unchanged
    template CSP (`connect-src 'none'`, `media-src 'none'`). `ISSUE` is added to the strict event
    schema and read through the same exact-source check.
  - _Validate untrusted input at every entry_: the template treats `INIT` data as untrusted. It
    checks the shape itself, renders gift text only as text and never as HTML, and survives
    malformed values by reporting `CONTENT_MISSING`.
  - _Gift documents reference media by asset ID only; storage keys never reach the browser_: the
    template reads photos only through `INIT` `assets`. Harness fixtures use inline `data:` images,
    not storage URLs.
  - _Audio never autoplays; reduced-motion and no-audio paths exist_: the template has no audio
    element, and the host keeps the gesture. The template has a reduced-motion path, and works
    completely without audio.
  - _Never log gift text_: `ISSUE` carries only field ids and item indexes, never content.
- **Code**:
  - new `templates/memory-box/` (manifest, fixtures, document, runtime modules, build script,
    tests);
  - `packages/template-sdk/src/messages.ts` and its tests;
  - `apps/web/src/modules/templates/`: `template-artifact-registry.ts`,
    `seed-template-catalog.ts` and `viewer-shell.tsx`;
  - the Viewer harness page, `scripts/database.ts`, `apps/web/package.json`, `next.config.ts`
    (one additive `transpilePackages` line), root `package.json` (`build:templates`),
    `vitest.config.ts`, `.prettierignore`, `eslint.config.mjs` (ignore `templates/*/releases/**`),
    and `apps/web/e2e/`.
- **Docs**:
  - `templates/README.md`;
  - `docs/templates/memory-box-storyboard.md` (status);
  - `docs/runbooks/passwordless-auth.md` (seed description).
- **APIs**: no new routes. The artifact route also serves `memory-box` `1.1.0`, and the harness
  serves `/viewer/memory-box/1.1.0`.
- **Data**: seed data only. Adds `memory-box@1.1.0`, sets `memory-box@1.0.0` to `retired` and
  changes `currentVersion`. No collection, validator, index or migration change.
- **Dependencies**: the template workspace declares `vite` (already in the root catalog and
  lockfile) as a build-time devDependency for bundling. No new package enters the lockfile.
