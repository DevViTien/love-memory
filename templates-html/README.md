# HTML templates

An `html` template is a single-page animation whose configurable values live in one configuration
object, in the style of the `animation-gift` collection. It is data, not a workspace: an operator
imports it, and its versions live in MongoDB (`templateVersions`) and object storage. Each folder
here is a bundled template that `pnpm db:seed` imports, published.

## Folder format

```text
<template-id>/
├── index.html      # the page, with its defaults in #gift-config
├── template.json   # the manifest: catalog metadata, fields with their path, steps, budgets
├── assets/         # optional: fonts, sample photos, thumbnail
├── artifact.lock.json  # bundled templates: the version and artifact hash, checked by a test
└── OFL.txt         # optional documentation (*.md, *.txt), never served
```

### `index.html`

- **Defaults.** The page needs an explicit `<head>` and exactly one JSON block with the defaults:

  ```html
  <script type="application/json" id="gift-config">
    {
      "startDate": "2023-08-14",
      "person1": { "name": "Minh", "avatar": "" },
      "photo": "assets/photo.jpg"
    }
  </script>
  ```

- **Configuration.** Read it with `const CONFIG = LoveGift.config();`. It returns the defaults with
  the gift's values merged in at each field's `path`.
- **When it runs.** In the gift page, the scripts run when the recipient opens the gift (the host's
  first `PLAY`), never behind the envelope. A template never starts in a frame by itself.
- **Reduced motion.** `LoveGift.reducedMotion()` is the recipient's request (also
  `data-reduced-motion="true"` on `<html>`). Honour it together with
  `matchMedia("(prefers-reduced-motion: reduce)")`.
- **Pause.** The gift page sends `PAUSE` when it is hidden and `PLAY` when it resumes. They reach
  the template as the window events `lovegift:pause` and `lovegift:play`.
- **Scripts.** They are classic inline `<script>` blocks. The importer moves each one into its own
  file, and the bootstrap runs them in order once the gift starts, after the document has loaded.
  `DOMContentLoaded` and `load` listeners and `window.onload` are still called.
- **Events.** Call `LoveGift.scene("name")` when the gift reaches a moment, and
  `LoveGift.complete()` when it reaches its end.
- **Refused:**
  - inline event handlers (`onclick=`), `javascript:` URLs, `<script src>` and module scripts;
  - `<link>` (also stylesheets and Google Fonts), `<iframe>`, `<object>`, `<embed>`, `<form>`,
    `<base>` and `<meta http-equiv>`;
  - any `http(s)://` or `//` URL in attributes, CSS (`url()`, `image-set()`, `@import`) or
    scripts, and root-relative URLs (`/assets/...`; write `assets/...`);
  - CSS escapes (`\`) in `<style>` and `style`, and an unterminated `url(` or string;
  - a `url()` naming anything else than a template file, `data:` or a `#fragment` in any
    attribute (also `fill`, `filter`, `mask` or `clip-path` of inline SVG);
  - an SVG `<set>` or `<animate>` that animates an `href`;
  - links other than `#fragment` links.
- **Fonts.** Bundle them as `assets/fonts/*.woff2` and declare them with `@font-face`. Commit the
  font's license (for example `OFL.txt`).
- **Music.** Leave it out. The gift page plays the licensed track that the creator chose, after the
  recipient's tap.
- **Network and storage.** The template has none. Its CSP denies network, media, forms and workers
  (`connect-src 'none'`), and allows images and fonts only from `/template-artifacts/`, `data:`
  URLs and the signed photo URLs. It runs sandboxed, even when its artifact URL is opened directly.
- **Not the trust boundary.** The importer's checks are a lint and a defence in depth. What keeps
  a template contained is the sandbox, the CSP and the gift page's checks: a frame that navigates
  away gets nothing more. Review a template's HTML before importing it.

### `template.json`

`template.json` holds the manifest of `@love-memory/template-sdk` with `"kind": "html"`.
`engineVersion`, `entry` and `previewFixture` are filled in by the importer. Its `status` is
stored with the manifest but never decides anything: the version is published only by
`--publish`, and stored as a draft otherwise.

**Fields.** Every field except `audio` has a `path` into the defaults, with a matching JSON type:

| Field type                               | Default at `path`                      | Value the template receives                   |
| ---------------------------------------- | -------------------------------------- | --------------------------------------------- |
| `shortText`, `longText`, `date`, `theme` | string                                 | the trimmed text (`date` as `YYYY-MM-DD`)     |
| `textList`                               | list of strings                        | the non-blank lines                           |
| `image`                                  | string (`""`, `data:` or `assets/...`) | the signed photo URL                          |
| `imageList`                              | list of strings                        | the signed photo URLs                         |
| `captionedImageList`                     | list of objects                        | `{ src, caption }` items                      |
| `passcode`                               | string                                 | the digits (a playful lock, never protection) |
| `color`                                  | string                                 | `#rrggbb`                                     |
| `audio`                                  | none (no `path`)                       | played by the gift page                       |

An empty optional value keeps the default. Give optional photos a neutral default (`""`), so a
recipient never sees a sample person.

**Steps.** Group the fields into Studio steps with Vietnamese labels.

**Budgets.** `budgets.initialJsKbGzip` is checked against the gzip size of all scripts, and
`initialMediaKb` against the size of `assets/`.

### `assets/`

- Allowed formats: `woff2`, `png`, `jpg`/`jpeg`, `webp` and `svg`.
- An SVG must be a plain image: well-formed tags only (no doctype, entity or CDATA), only the
  references `&amp; &lt; &gt; &quot; &apos;`, and no script, `foreignObject`, handler, external
  link or `url()`, or link animation, whatever the namespace prefix.
- Names use `A-Z a-z 0-9 . _ -`, with at most 6 path segments.
- Symbolic links are refused.
- Limits: an asset is at most 2 MB, there are at most 60 assets, and the folder is at most 8 MB.
  `index.html` is at most 512 KB.
- `assets/thumbnail.jpg` is the catalog picture.

## Importing

```bash
pnpm template:import templates-html/love-days --operator <your name> --publish
```

- **Configuration.** The command reads the configuration like `db:migrate`: MongoDB and the object
  storage of the tier.
- **On success** it prints one JSON line (`outcome` `imported`, `published` or `unchanged`) and
  records `admin.template.imported` in the audit log. Without `--publish` the version is stored as
  a draft. A refused folder lists every problem and writes nothing.
- **Immutability.** A version is immutable. Importing the same folder again changes nothing, but a
  changed folder needs a new `version` in `template.json`. A change to the bootstrap
  (`apps/web/src/modules/templates/infrastructure/love-gift-bootstrap.js`) changes every artifact,
  so it needs new versions of the bundled templates.
- **Bundled locks.** Each bundled folder commits `artifact.lock.json`
  (`{ "artifactContentHash", "version" }`). The unit suite prepares every folder and fails when
  its hash or version differs from the lock. After a deliberate change, bump `version` in
  `template.json`, then update the lock with the new hash from the failing test or the import
  output, in the same change.

## Previewing while authoring

The source `index.html` calls `LoveGift.config()`, which only the imported artifact provides. To
preview a template, import it into your local database with the local storage driver
(`STORAGE_DRIVER=local`, for example through `pnpm db:seed`). Then open
`/template-artifacts/<id>/<version>/<artifactContentHash>/index.html` from the import output
directly in the browser: outside the gift page, the bootstrap starts with the defaults.
