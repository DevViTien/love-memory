# Template workspace

Each template is an independent workspace under `templates/<template-id>` and must provide:

```text
template.manifest.json
dist/artifact.json
dist/build-metrics.json
dist/manifest.json
```

`template.manifest.json` follows `@love-memory/template-sdk`. The build must measure and write these
gzip/runtime metrics after producing the artifact:

```json
{
  "initialJsKbGzip": 100,
  "initialMediaKb": 500,
  "maxTextureMb": 32
}
```

The templates measure only `initialJsKbGzip` today and write `0` for the media and texture metrics;
a template that ships media or WebGL must measure those too before it can be published.

The root Vitest suite discovers every template directory, validates its manifest and fails CI when
the measured artifact exceeds any declared budget. A published template artifact is immutable.

## Building

`pnpm build:templates` builds every workspace under `templates/` (`pnpm --filter "./templates/*"
build`) and fails when any build fails. `pnpm test` and `pnpm test:coverage` run it first.

- `memory-box-spike` is the isolation reference: its runtime is a string in `src/document.ts`.
- `memory-box` bundles a typed runtime. `scripts/build.mjs` runs Vite in library mode on
  `src/runtime/main.ts` and minifies the result into **one** self-contained ES module
  (`runtime.mjs`). The build fails when the bundle has more than one chunk, any `import`, or a
  forbidden API: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`,
  `localStorage`, `sessionStorage`, `indexedDB`, `Worker`, or `<audio>`/`<video>` elements. The
  entry document `index.html` comes from `src/document.ts`. The runtime receives photos only
  through `INIT` `assets`, renders gift text with `textContent`, and never plays audio (the host
  owns the gesture and the audio).

## Releases

The served bytes of a released version are committed files, never a rebuild:

```text
templates/<template-id>/releases/<version>/
  index.html  runtime.mjs  manifest.json  preview.fixture.json  build-metrics.json  artifact.json
  release.json   # { "index.html": "…", "runtime.mjs": "…" } as JSON strings for imports
```

- Cut a release with `pnpm --filter <package> build` and then `pnpm --filter <package> release`.
  The `release` script copies `dist/` into `releases/<manifest version>/` and refuses to run when
  that directory already exists, when `dist/manifest.json` differs from `template.manifest.json`,
  or when `dist/artifact.json` does not match the built files. It writes into a git-ignored
  `releases/.staging-*` directory and renames it into place, so a failed run can simply be rerun.
- The web artifact registry (`apps/web/src/modules/templates/infrastructure/template-artifact-registry.ts`)
  serves released versions only from these files, through the package's `src/index.ts`.
  `dist/` only feeds the next, unreleased version.
- Tests fail when a release's `release.json` differs from its files, when its hash differs from
  `artifact.json` or from the hash pinned in `template-artifact-registry.test.ts`, when any release
  file's SHA-256 differs from the value pinned in the workspace's `releases.test.ts`, when its
  metrics exceed the manifest budgets, or when its preview fixture is invalid. Viewer harness
  fixtures are keyed per release and validated against that release's manifest.
- Changed artifact bytes always need a new version with its own release directory. Never edit,
  regenerate or format a committed release: `templates/*/releases/**` is excluded from Prettier
  and ESLint, and `.gitattributes` keeps the bytes LF on every platform. A release directory may
  be deleted and re-cut only while the change that introduces it is unmerged.
