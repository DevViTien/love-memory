# Design: the html template kind

## Context

- **What exists.** `sdk` templates (`memory-box`) are built in `templates/`, released as committed
  files, and served from a registry in the repository
  (`modules/templates/infrastructure/template-artifact-registry.ts`).
- **Execution.** Every consumer resolves the artifact through `resolveTemplateArtifact`: the viewer
  payload, preview, publish, the Studio and the artifact route. The Viewer runs it in a
  `sandbox="allow-scripts"` iframe over the `INIT`/`READY` protocol (ADR-0004, ADR-0005).
- **The change.** The pivot ([template-pivot-plan.md](../../../docs/sprints/template-pivot-plan.md),
  T1–T7) adds templates that are data. The decisions below implement them.

## Decisions

### D1. `kind` is optional, `path` lives on the field

`kind` is `sdk | html` and optional: absent means `sdk`. A parser default would break the seed's
check that stored manifests have no hidden defaults (`assertSeedTemplateReleases`). `path` is a
common optional field property, and a manifest-level refinement enforces the rules:

- `html` fields need a path; `audio` has none;
- no path repeats or contains another;
- prototype segments are refused;
- `sdk` fields have no path.

`templateKindOf(manifest)` reads the kind. `isImageField` now includes `image`, and
`imageFieldItemRange` gives every image field a `{ minItems, maxItems }`. That covers the media
quota, the viewer field summaries and the catalog requirement, so no consumer reads `maxItems` off
a field that has none.

### D2. Folder format and importer

The importer is pure application code: `prepareHtmlTemplate(source)` takes the files read from
disk and either returns the artifact files or throws `HtmlTemplateImportError` with every problem.

**The importer is a lint, not the trust boundary.** Its checks catch mistakes and obvious abuse
early, with readable messages, and they are a defence in depth. They are not complete: a template
script can still build a URL at run time. The trust boundary is:

- the `sandbox="allow-scripts"` frame, and the `sandbox allow-scripts` artifact CSP for a direct
  open (D4);
- the CSP itself: no network, forms or workers, and fonts and images only from
  `/template-artifacts/`;
- the host's checks (D8): messages only from that frame, and never again a message to a frame
  that navigated;
- the operator's review of the HTML before importing it.

The same is stated in ADR-0004.

- **HTML is parsed with `parse5`**, the parser behind jsdom, already in the lockfile, now a direct
  dependency of `apps/web`. It runs with source locations. The checks run on the tree: elements,
  attributes, URLs in attributes, `<style>` and `style`, scripts. The rewrite splices the original
  string by offsets, so everything outside the replaced scripts keeps its bytes. Regex scanning
  was rejected: it cannot be shown safe for attributes, comments, `<template>` content or SVG.
- **Inline scripts** become `script-{n}.js`. Each is replaced in place by an inert
  `<script type="application/x-love-gift-script" data-src="script-{n}.js">`. The bootstrap is
  inserted right after `<head>`. Scripts must be classic: module scripts and `<script src>` are
  refused, and so are authored placeholders of the reserved type.
- **URLs** are classified after removing ASCII whitespace and control characters, as browsers do.
  The allowed forms are empty, `#fragment`, `data:`, and a relative path to an existing template
  file without `..`. A root-relative path (`/assets/...`) is refused with a message asking for a
  path relative to `index.html`. `srcset` is split as the HTML standard does, so a `data:`
  candidate keeps its comma. CSS escapes (`\`) are refused in `<style>` and `style`, since they
  could spell a URL in pieces, and the strings of `image-set()` are checked like `url()`.
  Navigation links may only point at fragments. A script that contains an
  `http(s)://` URL other than a W3C namespace is refused. The CSP blocks network use anyway; the
  importer refuses it early, with a readable message.
- **Defaults** must have each field's path, with the JSON type of D5. Image defaults must be a
  template file, `data:` or empty, so a recipient never sees an unchecked URL.
- **Assets** are `woff2`, `png`, `jpg`/`jpeg`, `webp` or `svg`. Each name must be made of valid
  object key segments, at most 6 of them, which is the route's limit. Each file must start with
  its format's signature. Limits: `index.html` 512 KB, an asset 2 MB, 60 assets, 8 MB in all.
- **SVG assets** (`svg-asset-check.ts`) are tokenized strictly, without an XML library. Comments
  and a leading XML declaration are skipped. Any markup that is not a well-formed tag is refused:
  doctype, entities, CDATA, processing instructions and a stray `<`. Elements and attributes are
  judged by their local name, so a namespace prefix (`<s:script>`, `x:onload`) changes nothing. The
  root must be `svg`. Refused:
  - `script`, `foreignObject`, `handler`, `listener`, `iframe`, `embed` and `object` elements;
  - `on*` attributes;
  - links other than `#fragment` or `data:`;
  - animations of a link attribute;
  - `@import`, CSS escapes and external URLs.
- **CSS** (`css-url-scan.ts`). CSS is read the way CSS reads it: every `url()`, and every string of
  an `image-set()`. An unterminated `url(` or string is refused rather than guessed. The checks run
  on `<style>`, on `style`, and on any attribute value containing `url(` or `image-set(`, such as
  the SVG presentation attributes `fill`, `filter`, `mask` and `clip-path`, in `index.html` as in
  SVG assets. parse5 decodes character references in `index.html`, so `&#117;rl(` is seen as
  `url(`. The SVG tokenizer does not decode them, so SVG assets may use only `&amp;`, `&lt;`,
  `&gt;`, `&quot;` and `&apos;`. An SVG animation element may not animate a link attribute, in an
  asset or in inline SVG (`attributeName` containing `href`, in any case).
- **Folder.** Symbolic links are refused. `artifact.lock.json` (D7) is ignored.
- **Budgets.** `initialJsKbGzip` is the gzip size of the bootstrap and template scripts.
  `initialMediaKb` is the size of all assets. `maxTextureMb` cannot be measured and is reported as
  `0`.
- **Content address.** `sha256` of the sorted `name\0sha256` lines. The bootstrap embeds the
  field mapping, so the address covers it. A bootstrap change therefore needs new template
  versions, and the seed refuses to rewrite an existing one.

### D3. Storage and the version document (schema version `19`)

- **Files.** `private/templates/{id}/{version}/{artifactContentHash}/{name}`, written through the
  existing `ObjectStorage`. The local driver serves development and E2E, Vercel Blob the deployed
  tiers. A key already present is kept when its size and SHA-256 match, and rewritten otherwise. A
  store that lost or damaged files is repaired by importing again.
- **Document.** `templateVersions` `{id}@{version}` with:
  - `kind: "html"`, `manifest` (as authored, completed with `engineVersion`, `entry` and
    `previewFixture` `index.html`);
  - `contentHash` (manifest), `defaults`, `files[]` (`name`, `contentType`, `sha256`,
    `sizeBytes`, `storageKey`), `artifactContentHash` and `importedAt`.

  The validator checks those fields and requires them for `kind: "html"` through an `anyOf`, so
  `sdk` documents without `kind` stay valid. There is no backfill.

- **Writes.** One transaction stores the version, creates or updates `templates`, and inserts the
  `admin.template.imported` record (`mongo-html-template-repository.ts`). The template's current
  version only moves forward among published versions (`compareSemanticVersions`).
- **Immutability.** A stored `{id}@{version}` with another artifact hash, another manifest hash, or
  of kind `sdk` refuses the import before anything is written. The same content is a no-op;
  `--publish` turns a stored draft into a published version. The version's status comes only from
  `--publish`; the `status` inside `template.json` is stored with the manifest and never read.
- **Authorization.** The command is an operator command, like `admin:grant`: database and storage
  credentials are the authorization, and `--operator` names the person in the audit record. No
  HTTP endpoint writes templates.

### D4. Delivery

- **Resolution.** `composition/templates.ts` `findTemplateArtifact(id, version)` returns a
  `TemplateArtifactHandle` (`contentHash`, `kind`, `readFile(name)`): from the repository registry
  for `sdk`, otherwise from the `html` document. `resolveTemplateArtifact` adds the kill switch as
  before. `isTemplateVersionAvailable` became async, and with it the catalog's `TemplateAvailability`
  port. The admin template page checks artifacts the same way.
- **Route.** It moved from `[fileName]` to a catch-all `[...filePath]`. The artifact URL contract
  (`/template-artifacts/<id>/<ver>/<hash64>/index.html`) and `ViewerPayloadDtoSchema` are
  unchanged. Path segments are checked against the object key segment rules before any lookup.
  For `html`, the route reads the file from storage (at most 2 MB) and serves it only when its
  SHA-256 equals the recorded one. It answers `404` with an empty body otherwise, also when the
  object is missing from storage (`ObjectNotFoundError`).
- **Headers.** Unchanged: immutable caching (or `no-store` in local storage mode), `ETag`,
  `nosniff`, `Access-Control-Allow-Origin: *` (CORS for fonts and module scripts from the opaque
  origin), and the template CSP.
- **CSP (ADR-0005).**
  - **Fonts and images.** Template mode gains a path-scoped source,
    `<artifact origin>/template-artifacts/`, for `font-src` and `img-src`. The artifact origin is
    `APP_URL`, or, when `APP_URL` is unset, the request's `Host` if it is a plain host,
    IPv4 or bracketed IPv6 literal with an optional port, else the request URL's origin. It is
    never the server's bind address, which can differ (`localhost` against `127.0.0.1`). Because
    artifact URLs are relative and the CSP names `APP_URL`, every alias of a deployed tier must
    redirect to `APP_URL` (deployment runbook). A template can therefore load the
    files of template artifacts, but no other route of the application.
  - **Sandbox.** Responses under `/template-artifacts/` add `sandbox allow-scripts`, from the
    route and the proxy alike, so an artifact opened as a top-level page runs in an opaque origin.
    Fonts keep working, because the route answers `Access-Control-Allow-Origin: *`.
  - **Unchanged.** `connect-src`, `media-src`, `form-action`, `worker-src` and `object-src` stay
    `'none'`, and `script-src 'self'` is unchanged. The spikes routes keep their policy without
    `sandbox`.

### D5. The `LoveGift` bootstrap

`love-gift-bootstrap.js` is plain ES2019 in the repository. The importer copies it, with
`/* love-gift:fields */ []` replaced by the version's mapping (`id`, `path`, `type`). Unit tests
run the real artifact output in a jsdom iframe.

**Configure on `INIT`.** The first valid `INIT` from `window.parent` configures the gift, once
the document is parsed:

- it merges a deep copy of the defaults and sets the values with `setPath`;
- it records the host's reduced-motion request, as `LoveGift.reducedMotion()` and as
  `data-reduced-motion="true"` on `<html>`;
- it answers `READY`. A later `INIT` gets `READY` again.

**Run on `PLAY`.** The template's scripts run only on the first `PLAY`, the recipient's `Mở quà`.
Nothing of the template runs behind the envelope, and the template's opening animation starts when
the recipient sees it.

- Each deferred script is inserted as a `<script src>`, in order, each after the previous one's
  `load`.
- Late `DOMContentLoaded` and `load` listeners run one task later, and their errors still count.
- A `PLAY` before `INIT` is held. Later `PAUSE` and `PLAY` become the window events
  `lovegift:pause` and `lovegift:play`. The last one received while the scripts load is
  dispatched once they have started.

**Photos.** The signed asset URLs (300 s) arrive with `INIT`, but the scripts may run minutes
later. `configure()` therefore starts loading every photo of the merged configuration at once,
with `Image` objects kept in a module-level array, so the template's later `img.src` is served
from the document's image cache. Re-sending `INIT` with fresh URLs is not needed.

**Value mapping.**

| Field type                                                    | Configuration value                         |
| ------------------------------------------------------------- | ------------------------------------------- |
| `shortText`, `longText`, `date`, `theme`, `passcode`, `color` | trimmed string                              |
| `textList`                                                    | non-blank lines                             |
| `image`                                                       | the signed URL from `INIT` `assets`         |
| `imageList`                                                   | available URLs                              |
| `captionedImageList`                                          | `{ src, caption }` for each available photo |

An absent value keeps the default. A photo without an asset URL keeps the default too, and preview
lists it as `ASSET_UNAVAILABLE`.

**Failures.** A script `error` event, a script load error, or an error thrown during start posts
`ERROR` `RUNTIME_ERROR`, and the host shows its static fallback (after opening, as `gift-viewer`
allows). A malformed `INIT` gets `INVALID_MESSAGE`.

**Defaults mode.** Only a top-level open (`window.parent === window`) starts by itself, with the
defaults and the system's reduced motion: that is the author's preview. In a frame, the bootstrap
never starts without `INIT`. The host's handshake timeout (`INIT_TIMEOUT`) then shows the static
rendering, so a recipient never sees sample content as their gift.

**No network.** The bootstrap uses no network or storage API.

**Template events.** A template calls `LoveGift.scene(id)` and `LoveGift.complete()`. `love-days`
reports `heart-full` and completes when its photo opens.

### D6. Studio and viewer

- **Text lists.** `textList` keeps local lines (blank lines stay on screen) and saves the non-blank
  ones, removing the field when none is left.
- **Single photo.** `image` reuses `MediaImageListField` with `maxItems` 1 and a `single` summary,
  and stores the single asset id. Replacing it means deleting it first: the field quota is 1.
- **Passcode** filters to digits; **color** pairs a picker with a hex input and returns to the
  template default.
- **Help text.** A field's `helpText` is shown for every field type, image fields included, and
  its id comes first in `aria-describedby` of each of the field's inputs (`MediaImageListField`
  takes `helpTextId`).
- **Static fallback.** `textList` is one multiline paragraph and `image` one picture; `passcode` and
  `color` are never shown. The viewer field summaries carry `minItems`/`maxItems` for `textList`
  and `image`, so `CONTENT_TOO_FEW` reads `Add at least {n} items.` for lines.
- **Catalog.** `imageRequirement` sums every image field's range (shared
  `summarizeTemplateManifest`). The current templates have one image field, so their summaries do
  not change. `love-days` shows `1–3 ảnh`.

### D7. Seed and CI

- **Seed.** `db:seed` imports `templates-html/*` after the `sdk` releases, published, with the
  operator `db:seed` and `sortOrder` starting at `3`. Because it writes object storage, the CI E2E
  job runs `db:seed` with the local storage driver, as the Playwright web server already does.
- **Locked bundled artifacts.** Each `templates-html/<id>/artifact.lock.json` commits the
  `version` and `artifactContentHash` of that folder. A unit test prepares every bundled folder and
  compares the result with its lock, so a template or bootstrap edit must bump the version and the
  lock in the same change, instead of failing `db:seed` on a deployed tier. `love-days` stays
  `1.0.0`: it was never deployed.
- **Catalog after a rollback.** `mongoTemplateCatalog` reads manifests with `safeParse`. A version
  it cannot read is left out of the list and the detail, and is reported as
  `Template version skipped: unreadable manifest` with its `<templateId>@<version>` only. One such
  version never fails the catalog.
- **Ignores.** ESLint ignores `.tmp/`, where local storage keeps imported template scripts.
  Prettier ignores `templates-html/*/index.html`: authored bytes are imported as they are.

### D8. Frame navigation in the gift viewer

The gift viewer posts `INIT` with the payload and the signed asset URLs to the frame's window,
with target origin `*`: the frame's origin is opaque, so it cannot be named. A template that
navigates its own frame, for example with `location.replace("//evil.example")` or an SVG `<set>`
of an `href`, keeps the same `src` attribute. Its new document would then receive the next `INIT`
and could answer `READY`.

`createGiftViewerController.attach` therefore treats any second `load` of the artifact frame as a
navigation. It stops the handshake and only disconnects the bridge: it posts nothing, not even
`DESTROY`. It then switches to the static rendering with the new fallback reason `NAVIGATED`, which
preview counts as a template failure.

Because html templates run their scripts only after `PLAY` (D5), and `READY` has stopped the
handshake by then, no handshake message is pending when template code could navigate. The Viewer
harness keeps a new handshake on every load: it is diagnostic and shows fixture data only.

## Risks

- **Bootstrap changes.** A bootstrap fix changes every html artifact hash: existing versions must
  be re-released under a new version, and the seed fails until then. This is intended, because
  published gifts keep the bytes they pinned.
- **Rolling back past schema version 19.** The previous build's strict manifest parser throws on
  an `html` manifest:
  - its catalog fails;
  - `findEditableManifest` fails, so `/g`, preview and the Studio of every html gift answer `500`
    until the roll forward.

  Retiring the published html templates first, with the recorded list restored afterwards
  (deployment runbook), keeps the catalog working. Builds from this change skip unreadable
  catalog entries.

- **Handshake before READY.** Between a navigation and the second `load`, a resent `INIT` could
  reach the new document. This cannot happen with html templates, because their code runs only
  after `READY` (D8). It remains theoretical for `sdk` templates, which are repository code.
