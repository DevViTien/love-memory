# Design: the animation-gift templates

## Context

- **What exists.** `add-html-template-kind` added the `html` kind: the folder format, the importer
  (`prepareHtmlTemplate`), the `LoveGift` bootstrap, storage-backed artifacts, the seed of
  `templates-html/*` and `love-days`. `add-gift-qr-codes` added the QR panel.
- **The change.** Change 3 of the
  [template pivot plan](../../../docs/sprints/template-pivot-plan.md) (T9): port the five other
  `animation-gift` templates and show each template's own picture in the catalog.

## Decisions

### D1. Port each template as data, with two bootstrap changes

The bootstrap's field types already cover the five templates (`textList`, `image`, `imageList`,
`captionedImageList`, `passcode`, `color`), so the ports adapt to the bootstrap. The bootstrap
changes in two places. A promise rejection left unhandled while the template's scripts start
is reported as `RUNTIME_ERROR`, like a thrown error, so a template that waits on a promise (a
font) and forgets its rejection path fails visibly instead of staying blank. And the deferred
scripts are inserted with `crossOrigin = "anonymous"`: in the opaque-origin sandbox, a no-cors
script is "muted", and Chrome then fires no `unhandledrejection` for it and reports its errors
without details. The artifact route already answers `Access-Control-Allow-Origin: *`. The
bootstrap removes its `error` and `unhandledrejection` listeners two tasks after the late
`DOMContentLoaded`/`load` listeners and `window.onload` ran, because the browser reports their
rejections in a task of its own. `fail()`
still posts only the code `RUNTIME_ERROR`, never an error's message or a value. A Playwright test
frames a real artifact whose first script rejects a promise and expects `RUNTIME_ERROR`. A bootstrap change
changes every artifact hash. No html version has been deployed yet, so all six bundled templates,
`love-days` included, keep version `1.0.0` with new locks; after a first deployment this would
need new versions. Each port:

- moves `CONFIG` into `#gift-config` and reads `const CONFIG = LoveGift.config();`;
- removes the template's own `<audio>`, music button, hint and back link (T5: the host plays the
  licensed track after `Mở quà`);
- replaces the Google Fonts `<link>` with bundled `@font-face` rules: the woff2 files of the
  `vietnamese`, `latin-ext` and `latin` subsets, downloaded once from Google Fonts with a modern
  user agent, with the families' OFL licences as `OFL*.txt`;
- uses `LoveGift.reducedMotion() || matchMedia(...)` and adds the
  `html[data-reduced-motion="true"]` CSS block next to the `prefers-reduced-motion` one;
- stops its `requestAnimationFrame` loop and its timers on `lovegift:pause` and resumes them on
  `lovegift:play` (D6);
- waits for its canvas font with a timeout and a `catch`, and starts even when the font fails;
- calls `LoveGift.scene(...)` at its moments and `LoveGift.complete()` once at its end: the letter
  reached its end (`envelope-letter`), every big message passed once (`galaxy-text`), the photo
  appears (`heart-photo`), the heart closes the sequence (`matrix-text`), the letter is opened
  (`memories`).

### D2. Values are text, never markup

The original `memories` built its menu, album, letter and game status with `innerHTML` and an
`esc()` helper. The port builds those nodes with `createElement` and `textContent` (`el()` in the
template); `innerHTML` is kept only for constant SVG drawings of the template, never with a
configuration value. The other templates already used `textContent` or canvas text; their
`innerHTML` calls only insert generated SVG (flowers, hearts) without gift values. Photo
placeholders say `Chưa có ảnh` instead of echoing a file name.

### D3. Template-specific adaptations

- **Line breaks.** A `textList` line has no newline, while `galaxy-text`, `heart-photo` and
  `matrix-text` split their messages on `\n`. They now split on `|` as well; the help texts say
  so.
- **`envelope-letter`.** The name and defaults are generic (`Gửi / người thương / ♡`), not tied to
  20/10. `autoOpenMs` and `scrollSpeed` stay admin defaults. With reduced motion the letter does
  not auto-scroll.
- **`galaxy-text`.** `pageTitle`, `autoStartMs`, `density`, `speed` and the heart colours stay admin
  defaults; the proposal wording stays as the sample content and is named in the description.
- **`matrix-text`.** `rainChars` is upper-cased and stripped of spaces, `01` when empty.
  `countdown`, durations, `font`, `tapToReplay` and the rain palette stay admin defaults.
- **`memories`.**
  - Navigation was hash routing with `history.back()`. In a sandboxed frame that writes the joint
    session history, so the gift page's back button would step through the template. It is now
    an in-memory `show(name)`; back buttons return to the menu.
  - `sessionStorage` (the remembered unlock) is gone: a template has no storage.
  - `<form>` is refused by the importer: the lock is a `div` with a button and `Enter` handling.
  - The pin inputs are generated from the passcode's length. The default passcode is `""`, so an
    empty optional field (which keeps the default) never locks a gift with a code the recipient
    cannot know.
  - `startDate` (`YYYY-MM-DD`) is parsed as a local date, like `love-days`, not as UTC midnight.
  - An empty `popup.photo` falls back to the first album photo.
  - `role="button"` blocks get `tabindex="0"` and open with `Enter` or `Space`.
  - `menu` and `game` texts stay admin defaults.
- **Sample photos** are generated gradients with a heart (sharp, about 5 KB each). No photo of
  `animation-gift/assets/data/` is copied. The thumbnails are the collection's own
  `assets/thumbs/<id>.jpg` screenshots, which show no person.

### D4. Catalog thumbnail from the stored artifact

`summarizeTemplateManifest(manifest, artifact?)` takes the stored artifact's content address and
file names. For an `html` manifest whose files include `assets/thumbnail.jpg`, it sets
`thumbnailUrl` to `/template-artifacts/{id}/{version}/{hash}/assets/thumbnail.jpg`.
`mongoTemplateCatalog` passes `artifactContentHash` and the `files[].name` of the version document;
storage keys are never read into the summary.

- **View model.** The card view model exposes `thumbnail: { alt, src } | null`. It is `null` when
  the summary is not `available`: a killed or missing artifact answers `404`, and the catalog must
  not show a broken image.
- **Rendering.** `TemplateVisual` renders the thumbnail, a 1:2 phone screenshot, at 86 % of the
  frame's height on the template's gradient, so the 4:3 card and the 4:5 detail frame both show
  it whole. It is a plain lazy `<img>` with `width`/`height`, because the file is same-origin and
  content-addressed; Next image optimisation would add nothing.
- **CSP and caching.** The catalog pages use the static policy, whose `img-src` includes `'self'`.
  The artifact route serves the file with `image/jpeg`, `nosniff`, an `ETag` and immutable caching
  (`no-store` in local storage mode), as for every artifact file.
- **New gradients and icons** are added for the five templates. They show while a template is not
  available.

### D5. Catalog order of the bundled templates

The seed imported folders in name order and gave each the next `sortOrder`, but only a template
stored for the first time takes a `sortOrder`. With name order, `envelope-letter` would come before
`love-days` on a fresh database and share its `sortOrder` on an existing one.
`templates-html/catalog-order.json` (a JSON list of ids) fixes the order.
`listBundledHtmlTemplateFolders`
sorts by it, then by name for unlisted folders. Fresh and existing databases then agree:
`love-days` keeps `3`, and the new templates take `4` to `8`. A test checks that the file lists
every bundled folder.

### D6. Pause stops loops and timers; one loop at most

A hidden gift page must not advance a template's story: an envelope that opened by itself, or a
message sequence that completed while nobody looked, is lost to the recipient.

- **Timers.** `envelope-letter`, `galaxy-text`, `matrix-text` and `memories` use a small
  pause-aware timer helper (`clock.later(fn, ms)`, `clock.wait(ms)`): on `lovegift:pause` it
  clears every pending timeout and keeps its remaining time; on `lovegift:play` it re-arms them.
  The envelope's auto-open and reveal chain, the matrix countdown and message sequence, the galaxy
  tips and the memories steps all go through it, so nothing advances or calls
  `LoveGift.complete()` while paused.
- **Animation clocks.** Time-based animations shift their start by the paused duration on resume:
  `heart-photo`'s timeline, `galaxy-text`'s intro (`t0`), `matrix-text`'s current morph (`S.t0`).
- **One loop.** `heart-photo` requests frames through `requestFrame()`, which asks for a frame
  only when none is pending, after `go()` and while not paused; a `PLAY` that arrives during the
  font wait starts nothing, and `go()` runs once. The other loops already restart only when their
  frame saw the pause (`looping` false), so a quick `PAUSE`/`PLAY` keeps one chain; the harness
  measured 60 frames per second after such a sequence.
- **Completion.** `galaxy-text` completes when the next big message would start after every one
  has passed once (`heroIdx >= heroTexts.length`).

### D7. Retiring the sdk-era placeholders

`our-timeline` and `midnight-wish` were manifest-only placeholders (`Sắp ra mắt`) for Sprint 4
templates that the pivot replaced (plan.md §13.4, §13.5; T9). The seed no longer defines them.
`RETIRED_SEED_TEMPLATES` lists them, and `retireSeedTemplate` sets their stored `sdk` `1.0.0`
version to `retired` (never an `html` version: `kind: { $ne: "html" }`), and the `templates`
document only while its `currentVersion` is that placeholder version, all with `upsert: false`
and `status: { $ne: "retired" }`, so a re-run writes nothing.
An operator who re-published an id as an `html` template keeps it published. A fresh database never gets them,
an earlier one keeps their manifests (drafts that pin them stay editable, `Retired versions remain
resolvable for existing gifts`), and a re-run changes nothing. The html templates keep starting at
`sortOrder` `3` (`BUNDLED_HTML_FIRST_SORT_ORDER`), the first position after the old placeholders,
so fresh and earlier databases still agree.

### D8. Card details

- **Photo count.** A range whose ends are equal reads `1 ảnh`, not `1–1 ảnh`.
- **Thumbnails.** `envelope-letter` and `love-days` get new thumbnails: screenshots of the ports
  with their sample content (300×600), since the collection's pictures showed a file-name
  placeholder and a back button that the ports removed.
- **Examples without an artifact.** Spec scenarios about a published version without an
  artifact use the neutral id `future-template` instead of the retired placeholders; the detail
  page and the Studio's `Mẫu quà này sắp ra mắt.` state are covered by page tests.
- **Album by keyboard.** `memories` album photos are `role="button"` with `tabindex="0"`; `Enter`
  or `Space` opens one, `Escape` closes it and returns the focus.

## Risks

- **Canvas fonts.** `galaxy-text`, `heart-photo` and `matrix-text` draw text on canvas, which uses
  the font only once it has loaded. They wait for `document.fonts` with a timeout, catch a
  failure, and rebuild their sprites, so a slow or failed font only changes the glyphs.
- **Templates are long-lived code.** A bug fix in a ported template needs a new version and lock
  (`templates-html/README.md`), never an edit of `1.0.0`.
