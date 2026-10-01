# Tasks

## 1. Protocol: the `ISSUE` event (template-sdk and host)

- [x] 1.1 Add the strict `ISSUE` variant to `TemplateEventSchema` in `packages/template-sdk/src/messages.ts`: `protocolVersion` 1, `code` `ASSET_UNAVAILABLE`/`CONTENT_MISSING`, kebab `fieldId` 1–80, optional integer `itemIndex` 0–29. Export `TEMPLATE_ISSUE_CODES` and `TemplateIssueEvent`. Verify that `messages.test.ts` covers "Valid issue", every "Malformed issue" case, and that `readTrustedTemplateEvent` ignores an `ISSUE` from another source.
- [x] 1.2 Make `viewer-shell.tsx` log `ISSUE` events without changing the status. It keeps a set of distinct `(code, fieldId, itemIndex)` keys, resets it only when `connect()` runs with a new payload or the reduced-motion switch changes (never on handshake retries or iframe `load`), and renders `Vấn đề nội dung: {n}` from the set size. Verify that `type-check` and `eslint` pass on the file. The behavior is asserted by E2E in 5.4.

## 2. Template workspace and build

- [x] 2.1 Create `templates/memory-box`. It contains:
  - `package.json`: `@love-memory/template-memory-box`, `exports` `.` → `./src/index.ts` only, `build`, `release` and `type-check` scripts, and devDependencies `vite: catalog:` and `@love-memory/template-sdk: workspace:*`;
  - `tsconfig.json` with the DOM lib;
  - `template.manifest.json` exactly as in the "Release manifest" requirement;
  - `preview.fixture.json` with 5 photos (UUID asset ids), portrait and landscape, one without a caption, and no `audio`.

  Verify that `corepack pnpm install` changes no lockfile package version, and that a manifest unit test covers "Manifest resolves to the storyboard steps" and "Payload outside the contract".

- [x] 2.2 Add `src/index.ts`, which exports `MEMORY_BOX_RELEASES` (initially empty, filled by 4.2) and a stub `MEMORY_BOX_HARNESS_FIXTURES` (filled by 4.1). Add `templates/*/releases/**` to `.prettierignore` and to ESLint `globalIgnores`. Verify that `type-check` and `corepack pnpm -s lint` both pass on a clean checkout without any `dist/` directory.
- [x] 2.3 Write `scripts/build.mjs`:
  - bundle `src/runtime/main.ts` with Vite library mode into one minified ES chunk (`write: false`, es2022, no externals);
  - fail on more than one chunk, on any `import`, and on each forbidden API in the "Artifact constraints" requirement, naming it;
  - write `dist/index.html`, `runtime.mjs`, `preview.fixture.json`, `manifest.json`, `build-metrics.json` and `artifact.json` with the existing `contentHash` formula.

  Verify that `corepack pnpm --filter @love-memory/template-memory-box build` passes, that `test/template-budgets.test.ts` passes for both templates, and that a unit test of the extracted check function fails for a sample with `fetch(`, `import(` and `new Worker(`.

- [x] 2.4 Change root `build:templates` to build every template workspace (`pnpm --filter "./templates/*" build`, or an equivalent that fails when any build fails). Verify that `corepack pnpm build:templates` builds both workspaces, and that it exits non-zero when one build script is made to fail locally.
- [x] 2.5 Write `scripts/release.mjs` (package script `release`). It copies `dist/` into `releases/<manifest version>/` (`index.html`, `runtime.mjs`, `manifest.json`, `preview.fixture.json`, `build-metrics.json` and `artifact.json`), writes `release.json` with the two file bodies as JSON strings, and fails without writing when the directory already exists. Verify with a unit test of its extracted function (temporary directories): a fresh release, a refusal on an existing directory, and `release.json` byte-equal to the copied files.
- [x] 2.6 Add a `templates` Vitest project (jsdom, `templates/memory-box/src/**/*.test.ts`), and add `templates/memory-box/src/**/*.ts` to the coverage include in `vitest.config.ts`, excluding `*.d.ts`, `document.ts` and `fixtures.ts`. Verify that `corepack pnpm -s vitest run templates/memory-box` runs the new tests.

- [x] 2.7 Harden `createRelease` after review: refuse (writing nothing) when `dist/manifest.json` is not canonically equal to `template.manifest.json`, or when `dist/artifact.json` has a `contentHash` other than the hash of `dist/index.html` + `dist/runtime.mjs` or another `id`/`version`; write into a git-ignored `releases/.staging-<version>-*` directory and rename it into place, removing it on failure. Add `@types/node` (`catalog:`) to the workspace devDependencies. Verify unit tests for "Release step on an inconsistent build" (hash, manifest and artifact version cases) and "Release step fails while writing" (an injected write failure leaves no directory and a rerun succeeds), and that `corepack pnpm install --prefer-offline` only adds the `@types/node` importer entry to the lockfile.

## 3. Runtime (`templates/memory-box/src/runtime/`)

- [x] 3.1 Implement `payload.ts` and `format.ts`:
  - normalization of the untrusted `INIT` payload (trim, bounds, at most 8 memories);
  - `CONTENT_MISSING` detection for the four required fields;
  - a `DD/MM/YYYY` calendar date without time zones.

  Verify unit tests for "Empty payload", "Wrong value type", an invalid date omitted without an issue, and `2024-09-15` → `15/09/2024`.

- [x] 3.2 Implement `scenes.ts`: the ordered scene list `opening`, `memory-1..n`, `letter`, `finale`, skipping empty scenes, with the delays 5 s, 6 s, manual and 1.2 s (0 s under reduced motion). Verify unit tests for the full list, "Missing letter and memories", and the reduced-motion finale delay.
- [x] 3.3 Implement `protocol.ts`:
  - hand-written guards for `INIT`, `PLAY`, `PAUSE` and `DESTROY` that match the SDK schemas;
  - ignore any message whose source is not the parent window;
  - `post()` to the parent.

  Verify a test that runs the same valid and invalid samples through the guards and through `TemplateHostMessageSchema`, and expects identical accept/reject results.

- [x] 3.4 Implement `controller.ts`: the state machine `loading → cover → playing ⇄ paused → complete`, plus `failed` and `destroyed`, with injected timers, `post` and `render`. It works as follows:
  - each new `INIT` sends `READY`, then the deduplicated issues;
  - an `INIT` deep-equal to the current one answers `READY` only;
  - it sends `SCENE` per scene and `COMPLETE` once;
  - a malformed `INIT` gets `INVALID_MESSAGE`;
  - a `PLAY` before any valid `INIT` is held and starts the sequence after the first `READY`, without an `ERROR`;
  - `PLAY` resumes after `PAUSE`, and is ignored while playing and after `COMPLETE`.

  Verify fake-timer tests for "Cover after INIT", "Different INIT during playback", "Identical INIT resent", "Malformed INIT", "PLAY before INIT", "Full play-through", "Letter waits for the recipient", "Automatic advance", "Pause and resume" and "Pause before completion".

- [x] 3.5 Implement `render.ts` and `document.ts`:
  - the loading state, the cover (`Gửi {name}` or `Gửi bạn`, date, closed box, no open control), and the opening, memory, letter and finale scenes;
  - the `Tiếp` native button (44×44, visible focus, disabled while paused), `aria-live` on the stage, and a single `h1`;
  - `textContent` only, system fonts, `overflow-wrap: anywhere`, and a letter that scrolls vertically.

  Verify jsdom tests for "Markup in gift text", "Keyboard advance", the single `h1` and the reading order, and that no `<audio>` or `<video>` element exists.

- [x] 3.6 Implement the image handling from design D7:
  - `assets`-only resolution with `no-referrer`;
  - one `HTMLImageElement` per photo, preloaded in order after `READY` and then moved into its card (never a second `<img>` for the same URL);
  - a 4:5 `object-fit: cover` frame, and alt text from the caption or `Kỷ niệm {n}`;
  - a text card and `ASSET_UNAVAILABLE` with `itemIndex` for a missing URL, a non-string `assetId` or a load error.

  Verify tests for "Photo with caption", "Asset without a URL", "Photo fails to load" (simulated `error` event) and "Late scene after URL expiry" (the displayed node is the preloaded element and `src` was assigned exactly once).

- [x] 3.7 Implement `theme.ts`: the `rose-night` and `warm-paper` token sets applied as CSS variables, with a fallback to `rose-night`. Verify "Warm paper theme" and "Unknown theme", and a contrast test that computes text ≥ 4.5:1 and control/focus ≥ 3:1 for both themes.
- [x] 3.8 Implement the reduced-motion and motion rules:
  - `data-motion` on `<body>`;
  - no transforms, particles or breathing when reduced;
  - letter paragraphs shown at once when reduced;
  - at most 24 finale particles otherwise;
  - paused CSS animations on `PAUSE`.

  Verify "Reduced-motion finale" and "Normal finale" tests, including the particle count.

- [x] 3.9 Implement `fallback.ts` and the `guard()` error boundary. Wrap every handler, timer and image callback, and listen to window `error` and `unhandledrejection`. The static fallback shows all text in reading order, sends one `ERROR RUNTIME_ERROR`, then no more `SCENE` or `COMPLETE`. A later `INIT` recovers. Verify "Scene rendering throws" by injecting a throwing renderer, and verify a test where the fallback renderer also throws.
- [x] 3.10 Wire `main.ts` (`startMemoryBox(window)`) and rebuild. Verify that `build-metrics.json` `initialJsKbGzip` ≤ 60 (target < 20), that the build checks pass, and that per-file coverage thresholds pass for `templates/memory-box/src`.

- [x] 3.11 Apply the review fixes to the runtime: `PAUSE` sets `data-paused` on `<body>` in every animated state (cover, playing, after `COMPLETE`) and the CSS freezes animations through it; the finale moves focus from `Tiếp` to its `.closing` heading (`tabindex="-1"`); `.letter` and `.closing` get a `--mb-focus` outline on `:focus-visible`; while a scene plays, `#app` fills the frame and the photo frame sits in a size-contained `.frame-slot` so it shrinks (keeping 4:5) instead of pushing `Tiếp` out of a 320 px 9:16 frame. Verify render tests for "Pause on the cover", the paused finale after `COMPLETE`, "Keyboard focus reaches the finale" and the focus/layout rules, and a headless Chrome measurement of the `max-length` memory and letter scenes at 278 × 496, 320 × 569 and 600 × 450 CSS px with `Tiếp` inside the frame and no scrolling.

## 4. Harness fixtures and artifact registry

- [x] 4.1 Implement `src/fixtures.ts`, with SVG `data:` images in 4:5, 3:4 and 3:2 shapes:
  - `default`: the preview fixture plus its assets;
  - `max-length`: every text field at its maximum, 8 photos, 140-character captions with diacritics and emoji;
  - `missing-fields`: `{}`;
  - `broken-image`: one memory with no URL and one with `data:image/png;base64,AAAA`.

  Verify a test that `default`, `max-length` and `broken-image` pass full payload validation, that `missing-fields` passes draft validation, and that the suite fails naming a fixture made invalid ("Fixture fails validation").

- [x] 4.2 Cut the first `memory-box` `1.1.0` release with `build` then `release`, commit `templates/memory-box/releases/1.1.0/`, and import its JSON files in `src/index.ts` as a `MEMORY_BOX_RELEASES` entry. Verify with a workspace test that runs the "Committed template releases" checks for every release: `release.json` equals the raw files, the hash equals `artifact.json`, metrics are within budgets, and the preview fixture is valid. The released-value pin is added in 7.1.
- [x] 4.3 Change `TemplateArtifact.fixtures` in `template-artifact-registry.ts` to `{ payload, assets }`, with `assets: {}` for the spike fixtures. Register every `MEMORY_BOX_RELEASES` entry, never `dist/`. Add the package to `apps/web/package.json` and, as one additive line, to `transpilePackages` in `next.config.ts`. `add-local-object-storage` also edits that file. Add new registry and route test cases next to the existing ones without restructuring them. Verify that the tests cover "Exact version lookup", "Unknown version" (including `memory-box` `1.0.0`) and "Registry serves the committed release", and that the artifact route serves `memory-box` `1.1.0` files with the template CSP and immutable caching.
- [x] 4.4 Make the harness page pass `fixture.assets` to `ViewerShell`, and frame the mobile viewport as a portrait 9:16 iframe. Verify with `type-check` and `eslint`. The behavior is asserted by E2E in 5.4.

- [x] 4.5 Key `MEMORY_BOX_HARNESS_FIXTURES` by release version (the `default` fixture is the release's committed preview fixture) and give each registered release only its own set. Pin the SHA-256 of every committed release file in `templates/memory-box/src/releases.test.ts`, assert the directory holds exactly those files, and assert the release `manifest.json` and preview fixture equal the workspace sources while the versions match. Resolve release files in `template-artifact-registry.test.ts` from `import.meta.url` (node environment). Verify that every release's fixtures validate against that release's manifest, and that editing only the release `manifest.json` in place fails the suite ("Release manifest edited", checked and reverted).

## 5. Seed, catalog and E2E

- [x] 5.1 Replace `seedTemplateManifests` with ordered `seedTemplateReleases` in `seed-template-catalog.ts`:
  - move the preview fixtures there from `scripts/database.ts`;
  - versions hold the raw manifest as authored;
  - `memory-box` lists `1.0.0` (unchanged manifest and fixture, `retired`) and `1.1.0` (the committed release's `manifest.json` and `preview.fixture.json`, `published`);
  - module-load checks: every manifest parses, raw and parsed manifests are canonically equal (no hidden defaults), and `currentVersion` is a published version;
  - `seedTemplateCatalog` built from the current versions.

  Verify `seed-template-catalog.test.ts`: `memory-box` at `1.1.0` with `imageRequirement` 3–8, the other two at `1.0.0`, and the `1.0.0` manifest canonically equal to its pre-change form.

- [x] 5.2 Extract the per-version upsert into a testable function:
  - add `canonicalJson` (recursively sorted keys, no whitespace, array order kept);
  - it deep-compares `canonicalJson(stored.manifest)` with `canonicalJson(seed manifest)` and throws `Template release <id>@<version> is immutable and differs from the seed` on a mismatch, before any write for that template;
  - it writes `$set` for `status` and `updatedAt`, and `$setOnInsert` for the raw `manifest`, `previewFixture`, `contentHash = sha256(canonicalJson(manifest))` and the identity fields.

  Use the function from `scripts/database.ts`. Verify unit tests with a fake collection for:
  - a fresh insert;
  - "Stored manifest with a different key order" (idempotent, and nothing rewritten);
  - retiring `1.0.0` with its stored `contentHash` unchanged;
  - "Conflicting stored release".

  Also verify `canonicalJson` tests for key order, nesting and array order. Then run `corepack pnpm db:seed` twice and `corepack pnpm db:verify` against the local database. (Run by the coordinator after merge against the local database: `db:seed` twice and `db:verify` completed successfully.)

- [x] 5.3 Change the E2E idempotency-mismatch request in `apps/web/e2e/home.spec.ts` from `memory-box` `1.0.0` to `1.1.0`, and search the other E2E specs for any draft creation on `memory-box` `1.0.0`. Verify with `corepack pnpm -s eslint apps/web/e2e --max-warnings=0` and `type-check`. The coordinator runs the spec after merge.
- [x] 5.4 Add `apps/web/e2e/memory-box.spec.ts`. It covers:
  - `/viewer/memory-box/1.1.0` lists the 4 fixtures, reaches `READY` and shows `Vấn đề nội dung: 0`;
  - `Phát`, then `Tiếp` inside the frame through `opening`, 5 memories, `letter` and `finale`, reaching `COMPLETE`, with the logged `SCENE` order checked;
  - `broken-image` shows `Vấn đề nội dung: 2` (polled, and still 2 after the handshake settles) and text cards;
  - `missing-fields` shows `Gửi bạn` and completes;
  - reduced motion renders no particles;
  - `max-length` at a 320 × 690 page viewport (`page.setViewportSize`) in the mobile frame: the iframe is at most 320 px wide and no scene overflows horizontally;
  - the only `http:`/`https:` subresource requested by the artifact frame is `runtime.mjs` (`data:` fixture images are excluded);
  - there are no browser errors.

  It attaches `captureViewerScreenshot` captures for: the cover (both themes), opening, a memory card, a text card, the letter, the finale, the reduced-motion finale and the `missing-fields` cover. Verify with `eslint` and `type-check`. Playwright is run by the coordinator after merge.

- [x] 5.5 Remove the auto-advance race from `apps/web/e2e/memory-box.spec.ts`: captures during playback press `Tạm dừng` first and `Phát` after, and assert the scene while paused; `Tiếp` is pressed right after each scene assertion and the logged `SCENE` order is asserted; `broken-image` replays the iframe `load` event and polls until `READY` is logged more than once instead of a fixed 1.5 s wait; the 320 px test asserts `Tiếp` lies inside the frame viewport in the opening, every memory scene and the letter. Verify with `eslint` and `type-check`. Playwright is run by the coordinator after merge.

## 6. Documentation

- [x] 6.1 Update `templates/README.md`:
  - the bundled-runtime workspace pattern (Vite library mode, a single module, forbidden APIs);
  - committed releases under `releases/<version>/`, the `release` script, and the registry serving only releases;
  - `build:templates` building every workspace;
  - the rule that changed artifact bytes need a new version, and that release files are never edited or formatted.

  Verify that `corepack pnpm format:check` passes.

- [x] 6.2 Update the storyboard status in `docs/templates/memory-box-storyboard.md` (implemented as `memory-box@1.1.0`, pending Product Owner and design visual review). Update the seed paragraph of `docs/runbooks/passwordless-auth.md` (the retired `memory-box@1.0.0` and the immutability error with its dev-only recovery). Add the licensed-audio Product Owner dependency to plan.md's Gate M2 notes. Verify links resolve and `format:check` passes.

## 7. Release cut, verification and archive

- [x] 7.1 After all runtime work, re-cut the `1.1.0` release: delete `releases/1.1.0/` (allowed only while this change is unmerged), run `build` and `release`, and commit the result. Pin the released `contentHash` in `template-artifact-registry.test.ts`. (Re-cut once more after the code review fixes of 2.7, 3.11 and 4.5, before any deployment; the pinned `contentHash` and file hashes were updated then, and `1.1.0` is frozen from that point.) Verify that the "Tampered release" case fails when `runtime.mjs` and `artifact.json` are both edited in a scratch copy, and that a Vite version change affects only `dist/` and never the served `1.1.0` bytes ("Source changes after release"; checked by editing `document.ts` and seeing the registry test still pass).
- [x] 7.2 Run `corepack pnpm verify:local` (secrets, spec:check, format, lint, types, coverage, audit, build, installed-Chrome E2E) on the merged branch. Record in the PR any step that cannot run in a worktree: Playwright E2E and the visual captures of 5.4 need port 3100 and the shared `_e2e` database, so the coordinator runs them after merge and reviews the attached captures.
- [x] 7.3 Before archiving, re-diff every MODIFIED block against the then-current `openspec/specs/`, because earlier Sprint 3 archives may have changed `template-viewer-runtime`, `template-catalog` or `database-schema-management`. Then archive the change with `/opsx:archive add-memory-box-template` in the same PR, and verify that `corepack pnpm spec:check` passes afterwards.

## Out of scope

- The host envelope, tap-to-open control, audio controls (play, mute, replay), and the host static fallback on `ERROR` or `INIT` timeout (`add-gift-preview`).
- The preview route, the issues panel and `Sửa` links that consume `ISSUE` (`add-gift-preview`).
- Publishing, and the public Viewer that pins `artifactContentHash` (`add-temporary-gift-publish`).
- Scene analytics events (`add-funnel-analytics`).
- Pixel-diff `toHaveScreenshot` baselines. Revisit with a pinned Linux container (design D9).
- Safari iOS and Chrome Android exploratory checks, and the cold-cache performance baseline (Gate M2 work in `add-funnel-analytics`).
- An artifact for the retired `memory-box@1.0.0`.
- A shared runtime library for templates 2 and 3.
- Removing `memory-box-spike`.
