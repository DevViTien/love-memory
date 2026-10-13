# Add the animation-gift templates

## Why

Change 1 (`add-html-template-kind`) proved the `html` template kind end to end with `love-days`.
The pivot's first catalog (decision T9 of
[the template pivot plan](../../../docs/sprints/template-pivot-plan.md)) is the whole
`animation-gift` collection. This is change 3 of that plan: it ports the five other templates, so a
creator can choose between six configurable animations, and shows each one in the catalog with its
own picture instead of a generic gradient.

## What Changes

- **Five bundled templates**, each a folder under `templates-html/` at version `1.0.0`, ported from
  `animation-gift/templates/<id>/index.html`:
  - `envelope-letter` (`Thư tay`): card title lines, a polaroid photo, letter paragraphs.
  - `galaxy-text` (`Thông điệp giữa ngân hà`): opening texts, big messages, floating lines,
    optional photos and colors.
  - `heart-photo` (`Trái tim kỉ niệm`): messages inside the heart, 1–6 photos, a caption, colors.
  - `matrix-text` (`Lời nhắn ma trận`): messages, the heart text, the rain letters, colors.
  - `memories` (`Kỷ niệm của chúng mình`): love-days counter, captioned album, letter, caro game,
    and an optional playful passcode (empty means no lock).

  Each folder has its defaults in `#gift-config`, its manifest with Vietnamese steps and help
  texts, its bundled Google fonts (woff2, Vietnamese and Latin subsets) with their OFL licences,
  generated sample photos (no person), a 300×600 thumbnail and a locked artifact hash. The ports
  remove the template's own music and back links, render every gift value as text (DOM
  `textContent` or canvas, never markup), honour `LoveGift.reducedMotion()`, stop their loops and
  timers on `lovegift:pause` and resume them on `lovegift:play`, never wait forever for a font,
  and report scenes and completion.

- **Catalog thumbnails.** A catalog summary of an `html` version whose artifact holds
  `assets/thumbnail.jpg` carries that file's same-origin URL (`thumbnailUrl`). The catalog card and
  the template detail page show it, with an alt text naming the template, instead of the gradient
  and icon; `sdk` templates and templates that are not available keep their visual. A single-number
  photo range reads `1 ảnh`. `envelope-letter` and `love-days` get thumbnails taken from the ports.
- **Bootstrap.** A promise rejection left unhandled while the template's scripts start is
  reported as `RUNTIME_ERROR`, and the scripts load as CORS scripts so that browsers report it. Nothing html is deployed yet, so the six bundled templates keep
  version `1.0.0` with new locks.
- **Old placeholders retired.** The seed no longer creates the sdk-era catalog placeholders
  `our-timeline` and `midnight-wish` (`Sắp ra mắt`), and retires them where an earlier seed stored
  them.
- **Seed order.** `templates-html/catalog-order.json` lists the bundled templates in catalog order;
  `db:seed` imports them in that order (`love-days` first, then the five new ones), so a new
  template comes after the existing ones on every database.

## Capabilities

### New Capabilities

None. The new requirements extend existing capabilities.

### Modified Capabilities

- `template-catalog`: "Template summary is derived from the stored manifest" (`thumbnailUrl`),
  "Card presentation rules" (thumbnail, `1 ảnh`) and "Seeded launch templates" (six html
  templates, catalog order, placeholders retired); adds "Bundled animation templates".
- `database-schema-management`: "Template catalog seed" (the six html templates and their
  `sortOrder`, placeholders retired).
- `template-viewer-runtime`: "HTML template bootstrap" (unhandled rejection while starting).
- `template-catalog` "Template detail page" and `gift-drafts` "Create a draft bound to a published
  template version" and "Studio draft creation and editing flow", `studio-editor` "Studio preview
  and publish steps" and "Notice for template versions that cannot be published", and
  `template-version-controls` "Retire, kill and restore actions": examples use `future-template`
  (or `love-days` for a published template) instead of the retired placeholders.

## Non-goals

- New field types: the existing ones are enough.
- Admin upload of templates (plan.md §17.4 P1).
- Translating the templates' fixed English design texts (`Love Days`, `Caro Game`, …): they stay
  admin defaults of each template.
- Per-template E2E journeys for every template: one full journey (`memories`) plus a smoke test of
  each artifact.

## Impact

- **Code:** `templates-html/` (five folders, `catalog-order.json`, README);
  `modules/templates` (summary thumbnail, catalog read of the artifact file names, card view model
  and `TemplateVisual`, folder order); the template detail page; tests and the E2E spec
  `html-templates-catalog.spec.ts`.
- **Operations:** `db:seed` imports the five new folders (object storage configured, as for
  `love-days`). No schema version change.
- **Invariants:**
  - _Template code runs in `sandbox="allow-scripts"` without network access._ Unchanged; the new
    folders pass the importer's lint (no external URL, link, form or inline handler) and load only
    their own files.
  - _A template release is immutable._ Each folder commits `artifact.lock.json`; the suite fails
    when a folder changes under the same version.
  - _Storage keys never reach the browser._ The catalog reads only the artifact's file names and
    builds the `/template-artifacts/...` URL; no storage key is exposed.
  - _Audio starts only from a user gesture._ The templates' own `<audio>` is removed; the host plays
    the licensed track.
  - _Reduced-motion and no-audio paths always exist._ Every template honours the host's reduced
    motion request as well as the system setting.
