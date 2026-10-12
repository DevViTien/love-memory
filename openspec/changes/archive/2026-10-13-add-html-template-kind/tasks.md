# Tasks: add-html-template-kind

## 1. Template SDK

- [x] 1.1 The manifest gains the optional `kind` (`sdk`, `html`) and the field `path`, with the
      html path rules, `templateKindOf`, `isListField` and `imageFieldItemRange`; `isImageField`
      includes `image`. Schema tests cover kinds, paths and refusals.
- [x] 1.2 The field types `textList`, `image`, `passcode` and `color` with their draft and full
      value schemas, and image references and photo counts for `image`. Payload tests cover
      every type.

## 2. Importer and storage

- [x] 2.1 `html-template-document.ts`: parse5-based checks of the entry document, script
      extraction into deferred placeholders, and bootstrap injection.
- [x] 2.2 `html-template-import.ts`: manifest completion, default checks by path and type, asset
      checks, limits, measured budgets, files and the content address. Tests cover the happy path
      and every refusal.
- [x] 2.3 `import-html-template.ts`: the import service with its immutability check, file writes
      and outcomes. `mongo-html-template-repository.ts` writes version, template and audit record
      in one transaction; the storage file store keeps existing keys. Each has its tests.
- [x] 2.4 Schema version `19`: the `templateVersions` validator for `kind`, `files`, `defaults`,
      `artifactContentHash` and `importedAt`, with migration tests.
- [x] 2.5 The audit action `admin.template.imported`.
- [x] 2.6 `pnpm template:import` (`scripts/template-import.ts`, command parsing, folder reading)
      and `db:seed` importing `templates-html/*`, with tests of the folder reader, the seed and
      the command. CI runs the seed with the local storage driver.

## 3. Delivery and runtime

- [x] 3.1 Kind-aware artifact resolution (`findTemplateArtifact`, async availability for the
      catalog, the Studio and the admin template page) and the storage-backed html artifact
      source with its hash check.
- [x] 3.2 The catch-all artifact route with safe path segments, serving html files from storage
      with the same headers. Route tests cover sdk and html files and every 404.
- [x] 3.3 The template CSP allows fonts and images only from `/template-artifacts/` of the
      artifact origin (`APP_URL`, else the request `Host`), and artifact responses add the
      sandbox directive (`sandbox allow-scripts`) from the route and the proxy. CSP and route
      tests are updated.
- [x] 3.4 The `love-gift.js` bootstrap: value merge by path, `LoveGift` API, ordered script
      execution, `READY`, `ERROR`, late load listeners and the defaults mode. Tests run the real
      artifact in a jsdom iframe.
- [x] 3.5 Viewer field summaries, content issues and the static fallback for the new types, with
      tests.

## 4. Studio

- [x] 4.1 Inputs for `textList`, `image` (single photo), `passcode` and `color`, the field
      `helpText`, Vietnamese validation messages, and the media quota of an `image` field.
      Component, validation and media service tests cover them.

## 5. Love Days

- [x] 5.1 `templates-html/love-days`: `index.html` ported from `animation-gift`, with its
      `CONFIG` in `#gift-config`, `LoveGift.config()`, no back link or own music, and
      `LoveGift.scene` and `LoveGift.complete` calls. It ships the bundled Patrick Hand fonts
      (OFL), a sample photo, the thumbnail, and a `template.json` with Vietnamese labels and steps.
- [x] 5.2 The catalog visual and the summed photo requirement (`1–3 ảnh`), with tests.

## 6. End-to-end and documentation

- [x] 6.1 `apps/web/e2e/html-template.spec.ts`: a signed-in creator creates the draft from the
      catalog, fills the date, names, photo and caption, sees the preview with no issue, and
      publishes on Free. A fresh context opens `/g/{shareId}` and sees the names, date, caption,
      bundled font and photo inside the frame. The existing `home`, `studio`, `publish` and
      `media-upload` specs still pass.
- [x] 6.2 Documentation: the architecture templates section, `templates-html/README.md`
      (authoring format and `pnpm template:import`), `templates/README.md`, the deployment
      runbook (schema version `19`, seed and import) and an ADR-0004 consequence.

## 7. Review fixes

- [x] 7.1 The gift viewer treats a second load of the artifact frame as a navigation: it never
      posts to that window again and falls back with `NAVIGATED`. Controller regression tests
      cover it, and the preview counts it as a template failure.
- [x] 7.2 The bootstrap configures on `INIT`, runs the template scripts on the first `PLAY`,
      dispatches `lovegift:pause` and `lovegift:play`, exposes `LoveGift.reducedMotion()` and
      `data-reduced-motion`, and never starts in a frame by itself. `love-days` honours reduced
      motion. Bootstrap and E2E tests are updated.
- [x] 7.3 SVG assets are checked with a strict tokenizer by local name, including namespace
      prefixes and the root element. The importer also refuses root-relative URLs, CSS escapes,
      unsafe `image-set()` strings and asset paths over 6 segments, splits `srcset` like a
      browser, and refuses symbolic links. Each rule has tests.
- [x] 7.4 The catalog skips and reports a version whose manifest it cannot read, with a test. The
      runbook says how to retire html templates before rolling back past schema version `19`.
- [x] 7.5 `templates-html/love-days/artifact.lock.json`, checked by a unit test.
- [x] 7.6 The file store verifies an existing object's size and SHA-256 and rewrites a different
      one. The README documents `status` against `--publish`, locks, reduced motion and pause
      events.
- [x] 7.7 The help text of every field, image fields included, is linked first in
      `aria-describedby`, with tests.

## 8. Second review fixes

- [x] 8.1 The deployment runbook says that a rollback past `19` breaks html gifts (`500`) until
      the roll forward, retires only the published html templates and restores exactly those, and
      requires every alias to redirect to `APP_URL`.
- [x] 8.2 The bootstrap preloads every photo at `INIT` and dispatches the last `PAUSE` or `PLAY`
      received while its scripts load. Both have tests, and the love-days lock is updated.
- [x] 8.3 A shared CSS scanner (`css-url-scan.ts`) checks attributes containing `url(` or
      `image-set(` and refuses unterminated `url(` and strings. SVG assets refuse character
      references other than the five XML ones. `index.html` refuses animated links. Each review
      probe has a test.
- [x] 8.4 `templateArtifactOrigin` accepts only a well-formed `Host` that also parses as an
      origin (`a:99999` and `[:]` fall back), with tests. URL attributes are checked as URLs
      even when their value also contains `url(` or `image-set(`, with regression tests.
- [x] 8.5 A template file missing from storage answers `404` with an empty body, with tests.

## 9. Verification

- [x] 9.1 `pnpm openspec validate add-html-template-kind --strict` and `pnpm spec:check` (with
      the `modifiedBodyDrop` waivers for the schema version and CSP source changes).
- [x] 9.2 Type check, lint, format check and the unit suite with coverage; the E2E specs
      `html-template`, `publish`, `preview`, `home` and `studio`.

## Out of scope

- An admin page to upload, preview, publish and retire html templates (plan.md §17.4 P1).
- QR codes (`add-gift-qr-codes`) and the other five templates with catalog thumbnails
  (`add-animation-gift-templates`).
- The Viewer harness for html templates. It keeps a new handshake on every load: it is
  diagnostic and shows fixture data only.
