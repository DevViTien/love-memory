# Template pivot plan: admin-managed HTML templates, configuration and QR

Date: 2026-10-13. Product direction: [plan.md §1.1](../../plan.md). This plan replaces Sprint 4's
templates 2 and 3 (§13.4, §13.5) and brings QR (§13.3) forward. Every change follows OpenSpec:
propose, apply, review, `verify:local`, archive, commit.

## Goal

- An admin publishes **templates**: single-page HTML animations whose configurable values live in
  one `CONFIG` object, in the style of the `animation-gift` collection.
- A signed-in user picks a template and fills its configuration in the Studio: texts, lists of
  messages, dates, names, photos and licensed music.
- The output is the gift's own HTML page (`/g/{shareId}`) and a QR code that opens it.

## Decisions (2026-10-13)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1  | **Template kinds.** A second template kind, `html`, is data: its versions are stored in MongoDB (`templateVersions`) and its files in object storage. The `sdk` kind (`memory-box`, built in the repository) keeps working for existing gifts and stays in the catalog, but no new `sdk` template is planned.                                                                                                      |
| T2  | **Authoring.** An `html` template is a folder: `index.html` with its default configuration in a `<script type="application/json" id="gift-config">` block, a `template.json` manifest (catalog metadata, steps, and fields that each map to a `CONFIG` path), sample assets and a thumbnail. The template's code reads `LoveGift.config()`, which returns the defaults merged with the gift's values.              |
| T3  | **Import first, admin UI later.** Templates are imported with `pnpm template:import <folder>` (operator command, validated, audited, immutable per version). The seed imports the bundled templates. An admin page to upload and edit templates is the next stage (plan.md §17.4 P1).                                                                                                                              |
| T4  | **Isolation is unchanged.** `html` templates run in the same `sandbox="allow-scripts"` iframe, served from `/template-artifacts/...` with the network-denying template CSP. The importer moves inline scripts into files, refuses inline event handlers, `javascript:` URLs and any external URL, and requires fonts to be bundled files. The CSP allows the template's own files (`'self'`) for fonts and images. |
| T5  | **Music stays host-owned and licensed.** The `audio` field is not mapped into `CONFIG`: the gift page plays the licensed track after the opening gesture, as today. User-uploaded music is out of scope.                                                                                                                                                                                                           |
| T6  | **Field types.** Existing: `shortText`, `longText`, `date`, `imageList`, `captionedImageList`, `theme`, `audio`. New: `textList` (a list of short texts), `image` (one photo), `passcode` (4–8 digits, a playful lock inside the template, never access control) and `color`. An empty optional field keeps the template default.                                                                                  |
| T7  | **Plans and pricing are unchanged.** Free and Standard (`gift-plans`) apply to every template. The photo count includes `image` fields.                                                                                                                                                                                                                                                                            |
| T8  | **QR.** The published panel offers the share link as a QR code in three styles (plain, heart frame, phone wallpaper), downloadable as PNG and SVG, generated in the browser from the share URL.                                                                                                                                                                                                                    |
| T9  | **First catalog.** The six `animation-gift` templates are ported: `love-days` first (it proves the kind end to end), then `envelope-letter`, `galaxy-text`, `heart-photo`, `matrix-text` and `memories`.                                                                                                                                                                                                           |

## Changes, in order

| #   | Change                         | Outcome                                                                                                                                                                                                                                                                          |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `add-html-template-kind`       | The `html` kind: manifest `kind` and field `path`, the four new field types (SDK, Studio, viewer fallback), the importer and `pnpm template:import`, storage-backed artifacts, the `LoveGift` bootstrap, the CSP update, the seed, and `love-days` working from catalog to `/g`. |
| 2   | `add-gift-qr-codes`            | QR codes in three styles on the published panel, PNG and SVG download.                                                                                                                                                                                                           |
| 3   | `add-animation-gift-templates` | The five other templates, catalog thumbnails from the template files, and a viewer smoke test per template.                                                                                                                                                                      |

## Later

- An admin page to upload, preview, publish and retire `html` templates (plan.md §17.4 P1).
- A server-side access password (Sprint 4 §13.2), which the `passcode` field does not replace.
- A visual schema builder and in-browser editor (§17.4 P2).
