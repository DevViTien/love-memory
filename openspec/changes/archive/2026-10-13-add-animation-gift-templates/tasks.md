# Tasks: add-animation-gift-templates

## 1. Templates

- [x] 1.1 The bundled Google fonts of the five templates (Dancing Script, Nunito, Be Vietnam Pro,
      Quicksand, and Patrick Hand from `love-days`) are committed as woff2 subsets
      (`vietnamese`, `latin-ext`, `latin`) with their OFL licences, and every port declares them
      with `@font-face`.
- [x] 1.2 `envelope-letter` (`Thư tay`) is ported with generic defaults, its card title, photo and
      letter fields, scenes, completion at the end of the letter, and a paused auto-scroll.
- [x] 1.3 `galaxy-text` (`Thông điệp giữa ngân hà`) is ported with its opening texts, big messages
      (`|` as a line break), floating lines, optional photos and colours, and a paused drawing
      loop.
- [x] 1.4 `heart-photo` (`Trái tim kỉ niệm`) is ported with its messages, 1–6 photos, caption and
      colours, and a drawing loop whose timeline resumes after a pause.
- [x] 1.5 `matrix-text` (`Lời nhắn ma trận`) is ported with its messages, heart text, rain letters
      and colours, and a paused drawing loop.
- [x] 1.6 `memories` (`Kỷ niệm của chúng mình`) is ported: values built with `textContent`
      instead of `innerHTML`, in-memory navigation instead of hash routing, no session storage, a
      `div` lock instead of a `form`, pins from the passcode length with an empty default (no
      lock), a local start date, the album as `{ src, caption }`, and keyboard access to its
      `role="button"` blocks.
- [x] 1.7 Each folder has generated sample photos (no person), the collection's thumbnail as
      `assets/thumbnail.jpg`, a manifest with Vietnamese steps and help texts, budgets that the
      import measures under, and `artifact.lock.json`.
- [x] 1.8 Every template was checked visually with Playwright screenshots, at 390×844 and 320 px
      wide, opened top-level with its defaults and framed by a host that sends a sample gift, with
      and without reduced motion, without page or console errors.

## 2. Catalog and seed

- [x] 2.1 `summarizeTemplateManifest` takes the stored artifact and sets `thumbnailUrl` for an
      html version with `assets/thumbnail.jpg`; `mongoTemplateCatalog` passes the artifact hash
      and file names only. Unit tests cover both.
- [x] 2.2 The card view model exposes `thumbnail` (alt text, URL) for available templates, the five
      templates get their own gradient and icon, and `TemplateVisual` renders the picture on the
      catalog card and the detail page. View model and render tests cover it.
- [x] 2.3 The artifact route serves the thumbnail as `image/jpeg` with immutable caching and
      `nosniff`; a route test covers it.
- [x] 2.4 `templates-html/catalog-order.json` orders the bundled templates, and
      `listBundledHtmlTemplateFolders` follows it, so `db:seed` stores the five new templates after
      `love-days`. Tests cover the order, an unlisted folder and a malformed file.

## 3. Review fixes

- [x] 3.1 `heart-photo` starts even when its font fails (caught, with a timeout), and every
      template was checked for the same wait; the bootstrap reports an unhandled rejection while
      the scripts start as `RUNTIME_ERROR`, with tests. All six templates are relocked at `1.0.0`.
- [x] 3.2 `heart-photo` runs at most one drawing loop (`requestFrame()` with a pending flag, no
      frame before `go()`); the other loops were audited, and the harness measured one chain
      after a `PAUSE`/`PLAY` during the font wait.
- [x] 3.3 `envelope-letter`, `galaxy-text`, `matrix-text` and `memories` use pause-aware timers,
      and time-based animations shift by the paused duration; the harness showed that the
      envelope does not open, and the matrix sequence does not finish, while paused.
- [x] 3.4 `galaxy-text` completes once every big message has passed (`heroIdx >= length`).
- [x] 3.5 `heart-photo` messages are at most 24 characters, checked at 320 px, with a help text
      about `|` line breaks.
- [x] 3.6 The `envelope-letter` and `love-days` thumbnails are screenshots of the ports.
- [x] 3.7 The card shows `1 ảnh` for a single-number photo range, with a test.
- [x] 3.8 `memories` album photos are keyboard buttons (`Enter`/`Space`, `Escape`), covered by
      the E2E journey; the smoke test covers the memories intro without a passcode and the
      `heart-photo` line split.
- [x] 3.9 The seed no longer creates `our-timeline` and `midnight-wish` and retires them where they
      are stored, with tests; `home.spec.ts` checks they are gone from the catalog and creation.
- [x] 3.10 The canvas check of the smoke test works at any device pixel ratio, and the love-days
      QR test ignores only the Studio's own same-origin background reads.
- [x] 3.11 The bootstrap inserts the template's scripts as CORS scripts (`crossOrigin`), so a
      browser reports their rejections; a Playwright test frames an artifact whose script rejects
      while starting and gets only `RUNTIME_ERROR`.
- [x] 3.12 `retireSeedTemplate` retires only the stored `sdk` placeholder versions, and the
      template only while one of them is current; tests keep a re-published html template.
- [x] 3.13 Scenarios without an artifact use `future-template`; page tests cover the detail page's
      `Sắp ra mắt` and the Studio's `Mẫu quà này sắp ra mắt.`.
- [x] 3.14 `envelope-letter` runs no loop in reduced motion (0 frames per second after a
      `PAUSE`/`PLAY`), and Playwright tests cover the hidden gift page and a failed font.
- [x] 3.15 `heart-photo` has a thumbnail with its sample photo, and the README tells developers how
      to clear local databases that hold earlier `1.0.0` hashes.
- [x] 3.16 The bootstrap keeps its failure listeners one task longer, so a rejection from a late
      `onload` is reported (jsdom and Playwright tests); `retireSeedTemplate` skips records already
      retired; the page tests check the pinned version and the not-found page.

## 4. Tests and documentation

- [x] 4.1 `bundled-html-templates.test.ts` checks, per template, its identity, files, field paths
      and default types, a sample gift that a Free plan can publish, and the `CONFIG` the embedded
      bootstrap builds from it; the folder test checks every lock.
- [x] 4.2 The E2E spec `html-templates-catalog.spec.ts` covers the six thumbnails, a direct open of
      each artifact without errors, and the `memories` journey from the catalog to `/g/{shareId}`
      with the passcode, a captioned photo and the letter.
- [x] 4.3 `templates-html/README.md` lists the bundled templates and the authoring rules learnt
      from the ports (values as text, `|` line breaks, no navigation or storage, font subsets).
- [x] 4.4 Unit tests with coverage, lint, type-check, Prettier, `spec:check` and the E2E specs
      `html-templates-catalog` (chromium and mobile-chromium), `home`, `html-template`, `studio`,
      `publish` and `preview` (chromium) pass.

## Out of scope

- Admin upload and editing of html templates (plan.md §17.4 P1).
- A full E2E journey for each of the five templates; each gets an artifact smoke test, and
  `memories` the full journey.
- Translating the templates' fixed English design texts.
