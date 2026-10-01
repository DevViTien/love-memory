# Design

## Context

See proposal.md for why this change exists. Today:

- `templates/memory-box-spike` is the only template workspace.
  - `src/document.ts` exports the HTML document, the runtime and the fixtures as TypeScript
    strings.
  - `scripts/build.mjs` writes `dist/` (the HTML, `runtime.mjs`, the fixture, `manifest.json`,
    `build-metrics.json` and `artifact.json`).
  - The runtime is untyped JavaScript inside a `String.raw` template, and it cannot be unit-tested.
- `apps/web/src/modules/templates/infrastructure/template-artifact-registry.ts` imports those
  strings from `@love-memory/template-memory-box-spike`, computes the `contentHash` and serves the
  single artifact `memory-box-spike@0.1.0`. Its fixtures are bare payloads, and the harness page
  (`/viewer/[templateId]/[version]`) never passes `assetUrls` to `ViewerShell`, so `INIT` `assets`
  is always `{}`.
- `dist/` is git-ignored. CI runs `type-check` and `lint` before `test:coverage` (which runs
  `build:templates` first) and before `build`. So web code that type-checks cannot depend on build
  output existing. `build:templates` filters only the spike package.
- `packages/template-sdk/src/messages.ts` defines strict Zod schemas for host messages and template
  events. `readTrustedTemplateEvent` checks `event.source` against the iframe window and parses the
  data.
- The template CSP already allows `img-src data:`, the private Blob origin and the asset origin. It
  sets `media-src 'none'` and `connect-src 'none'`. Zod 4 `z.url()` accepts `data:` URLs, so
  `INIT` `assets` can carry inline images.
- `apps/web/src/modules/templates/infrastructure/seed-template-catalog.ts` holds three inline
  placeholder manifests, all at `1.0.0`. `scripts/database.ts` holds their preview fixtures, derives
  `sortOrder` from the array index and `$set`s `manifest`, `previewFixture` and `contentHash` on
  every run. `mongoGiftTemplateRepository` resolves creatable versions by the document `status`
  `published`, and editable versions by `published` or `retired`. The `status` inside a stored
  manifest is not used for lookups.
- E2E (`apps/web/e2e/home.spec.ts`) creates a `memory-box` `1.0.0` draft in the idempotency
  mismatch check. It runs the spike through the harness, and attaches screenshots with
  `captureViewerScreenshot`. No pixel baselines are committed.

Governing ADRs:

- **ADR-0004** (immutable, isolated template artifacts). The ADR says that "reduced-motion behavior
  and visual fixtures become release gates". This change implements that for Memory Box.
- **ADR-0005** (route CSP modes). No route or CSP change: the artifact route and the harness keep
  their modes.
- **ADR-0001** (modular monolith). The template stays an independent workspace, which the web app
  consumes only through its package API.

No decision here contradicts an accepted ADR.

## Goals / Non-Goals

**Goals:**

- Write the runtime in typed, unit-tested TypeScript modules, and still ship exactly two files,
  `index.html` and one `runtime.mjs`, under the 60 KiB gzip budget.
- Keep `type-check`, `lint` and `next build` working on a clean checkout without `dist/`.
- Make a released artifact byte-immutable without pinning the build toolchain forever: the served
  bytes of a released version are committed files, never a rebuild.
- Keep one source of truth for the `1.1.0` manifest and preview fixture: the committed release.
  The seed, the registry and the harness all read from it.
- Make every failure mode visible to the host (`ERROR` or `ISSUE`) and never lose the gift text.

**Non-Goals:**

- A shared runtime library for templates 2 and 3. Memory Box keeps its helpers local. Extracting
  them waits until a second template exists.
- A generic template build CLI. Each workspace keeps its own `scripts/build.mjs`.
- Changing the host's gesture, audio or fallback behavior (`add-gift-preview`).

## Decisions

### D1. Workspace layout and bundling with Vite library mode

`templates/memory-box/` is laid out as follows:

```text
template.manifest.json        # manifest of the version under development (1.1.0 in this change)
preview.fixture.json          # its default payload
src/index.ts                  # exports MEMORY_BOX_RELEASES (from releases/, see D2) and
                              #   MEMORY_BOX_HARNESS_FIXTURES
src/document.ts               # the index.html string: markup + inline <style>, themes as CSS vars
src/fixtures.ts               # harness fixtures { payload, assets } with data: SVG images
src/runtime/main.ts           # bundle entry: startMemoryBox(window)
src/runtime/{protocol,payload,scenes,controller,render,fallback,theme,format,images}.ts
src/test/harness.ts           # test-only controller harness (excluded from coverage)
scripts/build.mjs             # bundle + checks -> dist/
scripts/artifact-checks.mjs   # extracted, unit-tested bundle checks, hash and metrics
scripts/release.mjs           # dist/ -> releases/<version>/ (refuses to overwrite, see D2)
scripts/release-files.mjs     # extracted, unit-tested release function
releases/1.1.0/               # committed, immutable released bytes (see D2)
```

- `scripts/build.mjs` calls Vite's `build()` API in library mode:
  - `entry: src/runtime/main.ts`, `formats: ["es"]`, `write: false`;
  - `minify: true`, `target: "es2022"`, and no externals.
- Library mode keeps whitespace in ES output, so the build minifies the single chunk once more
  with Vite's exported `minify` (compress and mangle, module mode). `index.html` is loaded from
  `src/document.ts` with Vite's `runnerImport`. The workspace `tsconfig.json` sets
  `allowJs`/`checkJs`, so the `.mjs` scripts are type-checked and their extracted functions are
  unit-tested from `src/build-scripts.test.ts`.
- The build takes the single output chunk. It then **fails** in any of these cases:
  - there is more than one chunk;
  - the chunk contains an `import` statement or `import(`;
  - the chunk matches the forbidden API pattern `fetch(`, `XMLHttpRequest`, `WebSocket`,
    `EventSource`, `sendBeacon`, `localStorage`, `sessionStorage`, `indexedDB`, `Worker(`,
    `createElement("audio"|"video")`.
- It writes the same `dist/` files as the spike, with the same `contentHash` formula
  (`document \0 runtime`) and the same `build-metrics.json` shape. `initialMediaKb` and
  `maxTextureMb` are `0`, because the template ships no media or textures. The CI template gate
  (`test/template-budgets.test.ts`) keeps checking this source build.
- Types shared with the SDK (`TemplateEvent`, `TemplateHostMessage`) are imported with
  `import type`, so they cost no bytes. The runtime does **not** bundle Zod. It validates `INIT`
  with small hand-written guards, to stay far below the budget (the target is under 20 KiB gzip).
- The workspace declares `vite: catalog:` and `@love-memory/template-sdk: workspace:*` as
  devDependencies. The versions are already in the lockfile.

_Alternative rejected:_ keep the spike's `String.raw` runtime. It cannot be type-checked or
unit-tested, and a scene-based template is far too large to maintain as a string.

_Alternative rejected:_ `tsc` only. It emits one file per module, and the artifact route and the
"only `runtime.mjs` is requested" guarantee allow exactly one module.

_Alternative rejected:_ load several modules from the artifact. That needs an artifact route change
and more requests from the sandbox, for no benefit.

### D2. Released bytes are committed; the registry serves only committed releases

A released version is a directory of committed files, `templates/memory-box/releases/<version>/`:

- `index.html` and `runtime.mjs`: the exact served bytes, kept for review;
- `manifest.json`, `preview.fixture.json`, `build-metrics.json` and `artifact.json`, copied from
  `dist/`;
- `release.json`: `{ "index.html": "…", "runtime.mjs": "…" }`, the same bytes as JSON strings, so
  that TypeScript, Next.js and Vitest can import them without a text loader.

`scripts/release.mjs` (package script `release`) copies `dist/` into `releases/<manifest version>/`
and writes `release.json`. It **refuses** to run when that directory already exists. It also
refuses an inconsistent build: `dist/manifest.json` must be canonically equal to
`template.manifest.json`, and `dist/artifact.json` must carry the hash of `dist/index.html` and
`dist/runtime.mjs` and the manifest's `id` and `version`. It writes into a staging directory
(`releases/.staging-<version>-*`, git-ignored) and renames it into place only after every write
succeeded, so a failed run leaves no partial release and can simply be rerun. While this change is
open, the developer deletes `releases/1.1.0/` by hand before re-releasing. After the change
merges, nothing may touch it.

`1.1.0` was re-cut once after code review (runtime review fixes), before its first deployment and
before any gift referenced it. From then on it is frozen.

`src/index.ts` imports each release's JSON files (`resolveJsonModule`) and exports
`MEMORY_BOX_RELEASES`: `{ version, manifest, previewFixture, files, artifact, buildMetrics }[]`. The registry registers
every entry and computes `contentHash` from `files` with the existing formula, so the registry
remains the single place that serves hashes. The source build in `dist/` never reaches the
registry, so it only feeds the next, unreleased version.

Tests (`template-artifact-registry.test.ts` plus a workspace test) assert, for every committed
release:

- the `release.json` strings are byte-equal to `index.html` and `runtime.mjs`;
- the computed hash equals `artifact.json` `contentHash`;
- the hash equals a constant pinned in the test at release time. Editing released files
  therefore fails CI even if every file in the directory is regenerated consistently;
- the SHA-256 of the bytes of every committed file (`index.html`, `runtime.mjs`,
  `manifest.json`, `preview.fixture.json`, `build-metrics.json`, `artifact.json` and
  `release.json`) equals a value pinned per release in `templates/memory-box/src/releases.test.ts`,
  and the directory holds exactly those files. Metadata edits that leave the `contentHash` alone
  (a manifest, fixture or metrics change) fail too;
- while `template.manifest.json` has the release's version, the release `manifest.json` and
  `preview.fixture.json` are canonically equal to the workspace sources;
- `build-metrics.json` is within the release manifest's budgets, and `preview.fixture.json`
  passes full payload validation.

Consequences:

- A Vite, minifier or Vitest upgrade changes only the `dist/` build of the next version. Served
  `1.1.0` bytes, which published gifts will pin through `artifactContentHash`
  (`add-temporary-gift-publish`), never change. The toolchain does not have to be pinned forever.
- The web app imports the package through its `src/index.ts`, with no subpath export, no
  `dist/` dependency and no Turborepo change. `type-check`, `lint` and `next build` work on a
  clean checkout.
- `templates/*/releases/**` is added to `.prettierignore` and to ESLint `globalIgnores`, so
  formatters never rewrite released bytes. `.gitattributes` already forces LF, so the bytes are the
  same on Windows and Linux.
- The package is added to `apps/web` dependencies and to `transpilePackages` in `next.config.ts`
  (one additive line; `add-local-object-storage` also edits that file).

_Alternative rejected (was the first draft of this design):_ rebuild released bytes from source
and pin their hash. Any toolchain bump would then either fail CI forever, forcing permanent
toolchain pinning, or change the bytes behind published gifts.

_Alternative rejected:_ commit only the source and serve `dist/`. This is the same problem, and
it also makes type-check and `next build` depend on the build.

_Alternative rejected:_ the registry reads `releases/` with `fs` at runtime. That is fragile on
Vercel (file tracing outside `apps/web`). A JSON import is bundled with the server code.

The earlier objection to committing the bundle ("reviewed diffs contain minified code") is
accepted as a cost: a release diff happens once per version, and the reviewable source is in the
same PR.

### D3. Runtime structure: pure sequence plus a controller with injected effects

- `payload.ts` turns the untrusted `INIT` payload into a normalized `MemoryBoxContent` and a list of
  `CONTENT_MISSING` issues. It never throws on bad input:
  - strings are trimmed and bounded to the manifest limits;
  - memories are capped at 8;
  - `anniversary-date` is parsed as a calendar date and formatted `DD/MM/YYYY` without time zones.
- `scenes.ts` is a pure function from content to the ordered scene list (`opening`,
  `memory-1..n`, `letter`, `finale`). It skips empty scenes, and it holds the per-scene
  auto-advance delays: 5 s, 6 s, manual and 1.2 s (0 s under reduced motion).
- `controller.ts` is a state machine: `loading → cover → playing(scene) ⇄ paused → complete`, plus
  `failed` and `destroyed`. It takes injected `post`, `setTimer`/`clearTimer`, `render` and `now`,
  so tests drive it with fake timers and a jsdom root.
  - `PLAY` in `cover` starts the sequence. In `paused` it resumes, with the remaining delay of the
    current scene. In `playing` or `complete` it is ignored.
  - `PLAY` in `loading` (before any valid `INIT`) is held. The first valid `INIT` renders the cover,
    sends `READY` and then starts the sequence. See D5.
  - An `INIT` whose payload, assets and context are deep-equal to the current one only answers
    `READY` again. It does not reset, re-render or re-send issues. Any other valid `INIT` returns
    to `cover`.
- `render.ts` builds DOM only with `createElement` and `textContent` (never `innerHTML`). Each
  scene is a `<section data-scene="…">`, and the stage has `aria-live="polite"`. `Tiếp` is a
  `<button type="button">`.
  - Motion uses CSS classes, driven by `data-motion="full|reduced"` and `data-state` on `<body>`.
    `PAUSE` sets `data-paused` on `<body>`, whose rule sets `animation-play-state: paused`. It
    applies in every animated state: in `playing` (which becomes `paused`), on the `cover`
    (freezing the breathing; the next `PLAY` clears it and starts the sequence) and after
    `COMPLETE` (freezing the settling particles; `PLAY` only clears it). A new `INIT` clears it.
  - The cover's breathing animation runs only in `cover`, without reduced motion.
  - When `Tiếp` had focus, the next scene's `Tiếp` gets it. The finale has no `Tiếp`, so focus
    moves to its closing `<h2 tabindex="-1">` instead of falling back to `<body>`. The letter
    region and the closing heading use the `--mb-focus` outline on `:focus-visible`.
  - While a scene plays, `#app` is exactly the frame height and the stage and scene may shrink.
    A photo sits in a `.frame-slot` (`flex: 0 1 25rem`, `container-type: size`) whose 4:5 frame
    is `min(100cqh, 125cqw, 25rem)` tall: the frame gives up height, keeping 4:5, so the caption
    and `Tiếp` stay inside a 9:16 frame 320 px wide even with a 140-character caption. The letter
    region shrinks the same way. A text card keeps its 4:5 minimum and grows with its text.
- `theme.ts` holds the two palettes as token objects, which become CSS variables on `<body>`. A
  unit test computes the WCAG contrast ratios of the token pairs: text ≥ 4.5 and control/focus
  ≥ 3.
- `protocol.ts` handles messages:
  - it validates host messages with hand-written guards that mirror the SDK schema (exact keys,
    `protocolVersion` 1);
  - it ignores messages whose `event.source !== parent`;
  - it posts to `parent` with target `"*"`. The opaque origin allows nothing narrower; the host
    checks `event.source`.

### D4. Error boundary and static fallback

Every message handler, timer callback and image callback runs inside one `guard(fn)` wrapper.
`window` `error` and `unhandledrejection` listeners call the same failure path. On the first
failure, the controller does four things:

1. It moves to `failed` and clears all timers.
2. It renders `fallback.ts` from the last normalized content: plain headings and paragraphs with
   every text value in reading order, no images and no motion.
3. It posts `ERROR { code: "RUNTIME_ERROR" }` once.
4. It stops sending `SCENE` and `COMPLETE`.

If the fallback itself throws, the stage is replaced with a fixed Vietnamese sentence, and the
`ERROR` is still sent once. The host-side static fallback that `add-gift-preview` builds is the
second line of defense (Gate M2: "Template lỗi không làm mất nội dung cốt lõi").

### D5. The host owns the gesture; no `cover` SCENE event

The cover is the state after `READY`, so `READY` already signals it. Sending `SCENE cover` before
`PLAY` would break the documented order `READY → (PLAY) → SCENE → COMPLETE` and would count a
scene the recipient never chose to start. The cover has no in-frame open button. The host's
tap-to-open control (the harness `Phát` today, and the `GiftViewer` envelope later) starts audio
inside the gesture handler and then sends `PLAY`. This keeps the user activation in the top
document, where audio lives, and the template's CSP keeps `media-src 'none'`.

**Contract:** a production host sends `PLAY` only after it has received `READY`. This change adds
that rule to `template-viewer-runtime` "Lifecycle control". The Viewer harness is exempt, because
it is a diagnostic tool.

If a `PLAY` still arrives before any valid `INIT`, Memory Box holds it and starts playing right
after the first valid `INIT` and its `READY`. It does not answer `ERROR`. The `GiftViewer` in
`add-gift-preview` treats `ERROR` as "switch to the static fallback", so an early tap on a slow
network must not destroy the experience. The reference spike keeps its documented `ERROR`
`INVALID_MESSAGE` answer. A malformed `INIT` is still answered with `ERROR` `INVALID_MESSAGE` by
both templates, because the template cannot render anything from it.

### D6. `ISSUE` event: additive in protocol v1

`TemplateEventSchema` gains:

```ts
z.object({
  protocolVersion: z.literal(1),
  type: z.literal("ISSUE"),
  code: z.enum(["ASSET_UNAVAILABLE", "CONTENT_MISSING"]),
  fieldId: kebabIdSchema, // 1–80, same rule as manifest field ids
  itemIndex: z.int().min(0).max(29).optional(),
}).strict();
```

The SDK exports `TEMPLATE_ISSUE_CODES` and the `TemplateIssueEvent` type. `itemIndex` ≤ 29 follows
from the maximum `maxItems` of 30.

**Why a new event and not `ERROR`:** `ERROR` means the runtime failed. `add-gift-preview` reacts
to `ERROR` by switching to the host static fallback. A missing photo is recoverable content
feedback, and the gift keeps playing.

**Why the version stays `1`:** older hosts never receive `ISSUE` from older templates. A host
built before this change would reject an `ISSUE` from Memory Box as an unknown event, which the
trusted-event rule already ignores, and the template does not depend on an answer. So no old/new
pairing breaks.

**Re-sent INIT.** `ViewerShell` sends `INIT` on mount, on every 250 ms handshake retry until
`READY`, and on iframe `load`. So one logical initialization can reach the template two or three
times. Two rules keep issues exact:

- The template deduplicates by `(code, fieldId, itemIndex)` per accepted `INIT`. An `INIT`
  deep-equal to the current one re-sends nothing but `READY` (D3).
- `ViewerShell` appends every issue to the event log, does not change the status, and shows the
  number of **distinct** `(code, fieldId, itemIndex)` keys received since the payload or context
  last changed, as `Vấn đề nội dung: {n}`. It resets the set when `connect()` runs with a new
  payload or when the reduced-motion switch changes. Handshake retries do not reset it.

Preview (`add-gift-preview`) uses the same distinct-key rule for its issues panel.

### D7. Images: allowlisted URLs, one element per photo, text-card fallback

- The template resolves `assets[assetId]` only. At `INIT`, an item without a URL is marked
  unavailable, and its issue is sent right after `READY`.
- After `READY`, the template creates one `HTMLImageElement` per available photo, lazily and in
  order, with `referrerPolicy = "no-referrer"` and `decoding = "async"`. It loads them one at a
  time. The cover never waits for photos, and load failures surface early, which is useful for
  preview issues.
- The memory card **displays that same element**: it moves the node into the card. It never
  creates a second `<img>` with the same URL. If the preload has not reached the photo yet, the
  scene starts loading that element immediately. Each photo URL is therefore requested at most once
  per accepted `INIT`. This matters because signed asset URLs expire after 300 s
  (`media-upload`), and a late scene must not re-request an expired URL and raise a false
  `ASSET_UNAVAILABLE`.
- `onerror` marks the item unavailable, sends `ASSET_UNAVAILABLE`, and swaps in the text card if
  that scene is showing.
- The frame is `aspect-ratio: 4 / 5` with `object-fit: cover`, so portrait and landscape photos
  fill it without distortion. Photos come from the host as the 768-px derivative
  (`add-gift-preview`). The template never asks for a width, because it cannot fetch anything.
- A new, different `INIT` drops all elements, and the next one starts over.

### D8. Seed: releases per template, a retired release kept as stored, an immutability guard

- `seed-template-catalog.ts` replaces the flat `seedTemplateManifests` list with ordered
  `seedTemplateReleases`. Each entry is `{ templateId, currentVersion, versions: [{ manifest,
previewFixture, status }] }`, and its array position is its `sortOrder`. `manifest` is the **raw**
  manifest object as authored, not the parser's output.
  - The preview fixtures move there from `scripts/database.ts`.
  - `memory-box` lists two versions:
    - `1.0.0`: the unchanged inline manifest and fixture, with status `retired`. Its manifest keeps
      its internal `"status": "published"`, so it stays equal to what is stored. The registry
      document `status` is what lookups use.
    - `1.1.0`: the committed release's `manifest.json` and `preview.fixture.json` from
      `MEMORY_BOX_RELEASES` (D2), with status `published`.
  - Module-load checks:
    - every manifest parses with `parseTemplateManifest`;
    - every raw manifest already contains every key the parser would default, so the canonical
      JSON of the raw and parsed manifests is equal (no hidden defaults);
    - `currentVersion` is a `published` version of its entry.
- `seedTemplateCatalog` (the in-memory summary list) derives from the current versions only.
- **Canonical form.** `canonicalJson(value)` serializes with recursively sorted object keys and no
  whitespace, and keeps array order. It does not depend on SDK key order or defaults.
- A testable `upsertTemplateVersion` function (used by `scripts/database.ts`) works as follows:
  - It validates the preview fixture.
  - If a document for `<id>@<version>` exists and `canonicalJson(stored.manifest) !==
canonicalJson(seed manifest)`, it throws
    `Template release <id>@<version> is immutable and differs from the seed`. Nothing is written
    for that template. The comparison is a deep compare of the stored manifest itself, not of a
    stored hash, because older documents' `contentHash` was computed from
    `JSON.stringify(parsed)`.
  - It upserts with `$set: { status, updatedAt }` and
    `$setOnInsert: { manifest, previewFixture, contentHash, templateId, version, createdAt }`.
    New documents store the raw manifest, and
    `contentHash = sha256(canonicalJson(manifest))`. Existing documents keep their stored
    `manifest`, `previewFixture` and `contentHash` untouched.
  - Then `scripts/database.ts` upserts the `templates` document (`currentVersion`, `sortOrder`,
    `status`).
- No validator, index or `DATABASE_SCHEMA_VERSION` change. The existing enum already has
  `retired`.
- Authorization is unchanged. Creation resolves only `published` versions, and editing resolves
  `published` or `retired` versions.

_Alternative rejected:_ edit the stored `1.0.0` manifest's internal `status` to `retired`. That
rewrites an immutable release for no functional gain.

_Alternative rejected:_ compare `sha256(JSON.stringify(parseTemplateManifest(m)))`. The output
depends on the SDK's key order and defaults, so a harmless SDK refactor would make the seed
reject every stored release.

### D9. Harness fixtures, portrait mobile frame and visual captures

- The registry's `TemplateArtifact.fixtures` becomes
  `Record<string, { payload; assets: Record<string, string> }>`. The spike's fixtures get
  `assets: {}`. The harness page passes `fixture.assets` to `ViewerShell` `assetUrls`.
- `MEMORY_BOX_HARNESS_FIXTURES` is keyed by release version, then fixture name. The registry
  gives each release only its own set, the `default` fixture is that release's committed preview
  fixture, and a test validates every set against its release's `manifest.json`, so a later
  version with other fields never shows fixtures written for another manifest.
- Fixture images are small generated SVG `data:` URLs (gradients plus a label such as
  "Ảnh 1 · dọc"), in 4:5, 3:4 and 3:2 shapes. They are deterministic and under 1 KiB each.
  `broken-image` uses one UUID with no entry and one `data:image/png;base64,AAAA` URL.
- Only fixture payloads validate against the manifest. The template test suite runs full or draft
  validation per fixture (D10).
- In the mobile viewport, the harness iframe uses `aspect-[9/16]` inside `max-w-sm`. The desktop
  viewport keeps 4:3.
- The harness serves released versions only (D2). A developer iterating on an unreleased version
  re-runs `release` after deleting its directory, which is allowed only until the change merges.
- The E2E spec `apps/web/e2e/memory-box.spec.ts` walks each fixture through `Phát` and `Tiếp`
  (inside `frameLocator`).
  - It attaches `captureViewerScreenshot` images for the cover, opening, memory card, text card,
    letter, finale, reduced-motion finale and the `missing-fields` cover.
  - It asserts layout in code. For the `max-length` fixture it uses a 320 × 690 CSS-pixel page
    viewport with the mobile frame, asserts that the iframe is at most 320 px wide, and checks for
    no horizontal overflow (`scrollWidth <= clientWidth`) in every scene. It also asserts a
    particle count of at most 24.
  - It checks the event sequence and the distinct issue counts.
  - Captures during playback press the host `Tạm dừng` first (and `Phát` after), so no automatic
    advance can race the screenshot. `Tiếp` is pressed right after each scene assertion, and the
    logged `SCENE` order is asserted at the end.
  - `broken-image` replays the iframe `load` event and polls until `READY` is logged more than
    once, then checks that the distinct issue count is still 2 (no fixed sleep).
  - At 320 px, `Tiếp` must lie inside the frame's own viewport in the opening, every memory scene
    and the letter.
  - When it checks that the artifact frame requests only `runtime.mjs`, it considers only `http:`
    and `https:` requests. Inline `data:` fixture images are not network requests.

_Alternative rejected (for now):_ `toHaveScreenshot` pixel baselines. CI runs Linux Chromium, and
local `verify:local` runs installed Chrome on Windows. System fonts differ, so the change would need
two sets of committed baselines that flake on font updates. Attached captures plus code assertions
catch layout breakage, and humans review the captures. This can be revisited with a pinned
container. See Out of scope in tasks.md.

### D10. Tests

- **`packages/template-sdk/src/messages.test.ts`**: valid `ISSUE`; each rejection case from the
  spec; `readTrustedTemplateEvent` accepts `ISSUE` only from the expected source.
- **Template workspace tests** (`templates/memory-box/src/`, files ending in `.test.ts`): a new
  Vitest project with the jsdom environment. The coverage include adds the workspace's `src`
  TypeScript files, with the same per-file thresholds. Tests cover:
  - `payload` normalization and issues;
  - `scenes` ordering and skipping;
  - the `controller` with fake timers (every scenario in `memory-box-template`);
  - `render` (text only; markup literal);
  - `fallback`;
  - `theme` contrast;
  - `format` date;
  - fixture validation against the manifest with `parseTemplatePayload` or the draft schema.
- **`template-artifact-registry.test.ts`** (additive, next to the existing tests):
  - `memory-box@1.1.0` resolves, and `memory-box@1.0.0` resolves nothing;
  - every committed release passes the D2 checks, including the pinned hash;
  - fixtures carry assets.
- **`seed-template-catalog.test.ts`**: releases shape, current versions, the retired `1.0.0`
  manifest canonically equal to its pre-change form, no hidden defaults, and the summary lists
  `memory-box` `1.1.0`.
- **`upsertTemplateVersion`** (in `apps/web/src/modules/templates/infrastructure/`, tested with a
  fake collection):
  - a fresh insert, which stores the raw manifest and the canonical hash;
  - an idempotent re-run where the stored manifest has a different key order;
  - retirement, which leaves the stored `contentHash` unchanged;
  - a conflicting manifest, which throws and writes nothing.
  - `canonicalJson` has its own tests: key order, nested objects and array order.
- **`test/template-budgets.test.ts`**: unchanged. It discovers `templates/memory-box`
  automatically.

## Risks / Trade-offs

- **[Risk] Existing drafts pinned to `memory-box@1.0.0` have no artifact.** Preview and publish
  cannot run for them. → Mitigation: they remain editable (the retired rule). `add-gift-preview`
  must answer "no registered artifact" with a clear message, and `add-temporary-gift-publish`
  already requires a registered artifact. Only dev and staging drafts exist today.
- **[Risk] Released files are edited by hand, or regenerated consistently.** → Mitigation: the
  pinned `contentHash` per release in the registry test and the pinned SHA-256 of every release
  file in the workspace test (D2). The release script refuses to overwrite a
  release, and formatters ignore `releases/`.
- **[Risk] The source build and the committed release drift.** For example, the source is fixed
  but the release is not re-cut. → Mitigation: this is intended once released. A source change
  ships as a new version with a new release directory. While this change is open, the tasks
  re-cut `1.1.0` last (task 7.1), after all runtime work.
- **[Risk] The seed immutability guard fails on a developer database whose stored manifest
  differs in content,** for example one seeded from an uncommitted experiment. → Mitigation: the
  compare is canonical, so key order and serialization never trigger it. The error names the
  release, and the runbook says to drop that local `templateVersions` document (dev only).
- **[Trade-off] Hand-written `INIT` guards duplicate the SDK schema.** → They are small, tested
  against the SDK's schema in the same test file (valid and invalid samples must agree), and keep
  Zod out of the budget.
- **[Trade-off] Auto-advance timers (5 s and 6 s) on the opening and memory scenes.** → Every scene
  has `Tiếp`, and the letter never auto-advances. Timers pause with `PAUSE` and when the tab is
  hidden (the host sends `PAUSE`). WCAG 2.2.2 pause control is provided by the host `Tạm dừng` and
  pause-on-hidden.

## Migration Plan

1. Merge the SDK `ISSUE` event first (additive). Old hosts ignore it.
2. Ship the workspace (with the committed `releases/1.1.0/`), the registry entry and the harness
   changes in the same deployment. `next build` needs no template build, because it imports the
   committed release.
3. Run `pnpm db:seed` on each environment after deploying (the runbook step is unchanged). It
   inserts `memory-box@1.1.0`, retires `1.0.0` and switches `currentVersion`.
4. **Rollback:** redeploy the previous build. The seed data needs no revert:
   - The old code can still edit `1.1.0` drafts, because `captionedImageList` exists since the
     previous change.
   - The old catalog code reads `currentVersion` `1.1.0`, which is a published version with a
     valid manifest.
   - If `1.0.0` must be current again, set `templates.memory-box.currentVersion` back and set
     `memory-box@1.0.0` to `published` by hand. Manifests are never touched.

## Open Questions

- The Product Owner and design review of the storyboard narrative is still recorded as pending in
  `docs/templates/memory-box-storyboard.md`. Implementation follows the agreed v1.1 input contract.
  Visual details such as palette values, box illustration and particle shapes can change during
  review without changing specs or tasks, as long as the contrast and budget requirements hold.
- Licensed audio tracks for the Gate M2 demo are still a Product Owner dependency (from
  `change-template-contract-for-studio`). This change adds the note to plan.md's Gate M2 section.
