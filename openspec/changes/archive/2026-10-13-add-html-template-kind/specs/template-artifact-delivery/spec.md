## ADDED Requirements

### Requirement: HTML template folder

The system SHALL accept an `html` template as a folder holding `index.html`, `template.json`, an
optional `assets/` directory and optional documentation files (`*.md`, `*.txt`, for example a
font license); any other top-level entry, and any symbolic link, MUST refuse the folder. The
`artifact.lock.json` of a bundled template ("HTML template import command") is ignored. `template.json` is the manifest
of `template-manifest-contract` with `kind` `html`; `engineVersion`, `entry` (`index.html`) and
`previewFixture` (`index.html`) MAY be omitted and are then filled in. The importer SHALL check the
whole folder and refuse it, listing every problem and writing nothing, when:

- `index.html` has no explicit `<head>`, or not exactly one
  `<script type="application/json" id="gift-config">` holding a JSON object (the defaults);
- a field `path` does not exist in the defaults, or its default has the wrong JSON type: a string
  for `shortText`, `longText`, `date`, `theme`, `image`, `passcode` and `color`, a list of strings
  for `textList` and `imageList`, a list of objects for `captionedImageList`; an image default
  must be empty, a `data:` URL or a file of the template;
- the document has an inline event handler (`on*`), `srcdoc`, `action` or `formaction`, a
  `<script src>`, a module script, a script inside SVG, a script containing an `http://` or
  `https://` URL other than a `http://www.w3.org/` namespace, or one of `<link>`, `<iframe>`,
  `<frame>`, `<object>`, `<embed>`, `<applet>`, `<portal>`, `<form>`, `<base>` and
  `<meta http-equiv>`;
- a URL in `src`, `href`, `srcset`, `poster` or another URL attribute, in a `style` attribute or a
  `<style>` element (`url()`) is not a file of the template, a `data:` URL or a `#fragment`,
  including `javascript:` and protocol-relative URLs; a root-relative URL such as
  `/assets/photo.jpg` is refused with a message asking for a path relative to `index.html`; CSS
  `@import` and CSS escapes (`\`) are refused, and every string of an `image-set()` is checked
  like a `url()`; the same CSS checks apply to every attribute whose value contains `url(` or
  `image-set(`, such as the SVG presentation attributes `fill`, `filter`, `mask` and
  `clip-path`; an unterminated `url(`, `image-set(` or string inside them is refused; an SVG
  animation element (`set`, `animate`, `animateMotion`, `animateTransform`) of inline SVG may not
  animate a link attribute (an `attributeName` containing `href`, in any case); a `srcset` is split like a browser splits it, so a `data:` candidate keeps its
  comma; a link (`<a>`, `<area>`) may only point at a `#fragment`;
- an asset is not under `assets/`, has a name outside `A-Z a-z 0-9 . _ -` or more than 6 path
  segments, is not a `woff2`, `png`, `jpg`, `jpeg`, `webp` or `svg` file, or does not start with
  its format's signature;
- an SVG asset is not a well-formed SVG image. It is tokenized strictly (no doctype, entity, CDATA
  or processing instruction, a root element named `svg`) and judged by local names whatever the
  namespace prefix: `script`, `foreignObject`, `handler`, `listener`, `iframe`, `embed` and
  `object` elements, `on*` attributes, links other than a `#fragment` or a `data:` URL, an
  animation of a link attribute, `@import`, CSS escapes, a `url()` other than a `#fragment` or
  `data:` URL in any attribute, an unterminated `url(` or string, character references other
  than `&amp;`, `&lt;`, `&gt;`, `&quot;` and `&apos;`, and external or `javascript:` URLs are
  refused;
- `index.html` exceeds 512 KB, an asset exceeds 2 MB, there are more than 60 assets, or the
  folder exceeds 8 MB;
- the measured budgets exceed the manifest's `budgets`: `initialJsKbGzip` is the gzip size of all
  JavaScript (bootstrap and template scripts), `initialMediaKb` the size of all assets.

An accepted folder becomes the artifact files: `index.html` with `<script src="love-gift.js">`
inserted first in `<head>` and each inline script replaced in place by an inert
`<script type="application/x-love-gift-script" data-src="script-{n}.js">`; the bootstrap
`love-gift.js` with the version's field mapping (`template-viewer-runtime`); the extracted
`script-{n}.js` files; and every asset. The artifact `contentHash` SHALL be the SHA-256 of the
lines `{name}\0{sha256}` of every file, sorted by name and joined by `\n`. The rest of the
document keeps its exact bytes, so the same folder always gives the same `contentHash`.

These checks are a lint and a defence in depth, not the trust boundary. The trust boundary is the
`sandbox="allow-scripts"` frame and the sandboxed artifact CSP ("Network-denying artifact CSP"),
the host's message and navigation checks (`template-viewer-runtime`), and the operator's review of
the HTML before importing it.

#### Scenario: Love Days folder

- **WHEN** `templates-html/love-days` is checked
- **THEN** it is accepted with the files `index.html`, `love-gift.js`, `script-1.js`, the bundled
  Patrick Hand fonts, `assets/photo.jpg` and `assets/thumbnail.jpg`

#### Scenario: Inline handler or external URL

- **WHEN** `index.html` contains `<button onclick="go()">`, `<img src="https://cdn.example/x.png">`,
  `<img src="//cdn.example/x.png">` or `<a href="../../">`
- **THEN** the import is refused and lists each problem

#### Scenario: Google Fonts link

- **WHEN** `index.html` loads a font with `<link href="https://fonts.googleapis.com/...">`
- **THEN** the import is refused; the font must be bundled under `assets/fonts/` and declared with
  `@font-face`

#### Scenario: Namespace-prefixed SVG script

- **WHEN** an SVG asset contains `<s:script>`, `<h:foreignObject>` or an `x:onload` attribute
- **THEN** the import is refused naming the asset

#### Scenario: URL in a presentation attribute or spelled with references

- **WHEN** inline SVG has `fill="url(//evil.example/f.svg#f)"`, a `style` has
  `fill:&#117;rl(...)`, an SVG asset uses `&#104;ref`, or a `<style>` ends inside `url(`
- **THEN** the import is refused

#### Scenario: Animated link

- **WHEN** `index.html` contains `<svg><a href="#x"><set attributeName="href" to="/g/abc"/></a></svg>`
- **THEN** the import is refused

#### Scenario: Root-relative URL

- **WHEN** `index.html` contains `<img src="/assets/photo.png">`
- **THEN** the import is refused with a message asking for `assets/photo.png`, relative to
  `index.html`

#### Scenario: Default that does not match its field

- **WHEN** a field's `path` is missing from the defaults, or a `textList` default is a string
- **THEN** the import is refused naming the field and its path

#### Scenario: Over budget

- **WHEN** the gzip size of the JavaScript exceeds `budgets.initialJsKbGzip`
- **THEN** the import is refused with `Budget initialJsKbGzip: {actual} > {limit}`

### Requirement: HTML template import command

The system SHALL provide `pnpm template:import <folder> --operator <name> [--publish]`, which reads
the configuration like `db:migrate`, checks the folder (`HTML template folder`) and then:

1. refuses, writing nothing, when `<templateId>@<version>` is already stored with another artifact
   `contentHash`, another manifest `contentHash`, or as an `sdk` version: a template version is
   immutable;
2. writes every file to object storage at
   `private/templates/{templateId}/{version}/{contentHash}/{name}`, keeping a file already there
   when its size and SHA-256 match, and rewriting it otherwise;
3. stores, in one transaction, the `templateVersions` document `<templateId>@<version>` with
   `kind` `html`, `manifest`, `contentHash` of the manifest, `defaults`, `files` (`name`,
   `contentType`, `sha256`, `sizeBytes`, `storageKey`), `artifactContentHash`, `importedAt`, and
   status `published` with `--publish`, else `draft` (the `status` inside `template.json` is
   stored with the manifest but never decides the version's status); creates the `templates` document when
   missing (appended to the catalog order); with `--publish`, makes the version current unless a
   newer published version is current; and records `admin.template.imported` (`audit-log`) with
   the operator as actor and the metadata `artifactHash`, `files` and `published`.

Importing the same folder again SHALL change nothing, except that `--publish` publishes a stored
draft of it, and SHALL write again only files missing from storage. The command SHALL print one
JSON line with `templateId`, `version`, `artifactContentHash`, the measured budgets, `files`,
`status` and `outcome` (`imported`, `published` or `unchanged`). A refused folder SHALL print every
problem and exit with a non-zero status; a missing folder or operator SHALL fail with its usage.
`db:seed` SHALL import every folder under `templates-html/` the same way, published, with the
operator `db:seed` (`template-catalog` "Seeded launch templates"). Each bundled folder SHALL commit
`artifact.lock.json` with its `version` and `artifactContentHash`, and the test suite MUST fail
when preparing the folder gives another hash or version: a change to a bundled template or to the
bootstrap then needs a new version in the same change.

#### Scenario: First import

- **WHEN** `pnpm template:import templates-html/love-days --operator truong --publish` runs on a
  database without `love-days`
- **THEN** the files are in storage, `love-days@1.0.0` is stored `published` with `kind` `html`,
  `love-days` is current at `1.0.0`, and one `admin.template.imported` record names the operator

#### Scenario: Re-import

- **WHEN** the same folder is imported again
- **THEN** the output has `outcome` `unchanged`, nothing is written to MongoDB, and no audit record
  is added

#### Scenario: Changed folder under the same version

- **WHEN** `index.html` changes and the folder is imported again without a new `version`
- **THEN** the import fails because the version is immutable, and nothing is written

#### Scenario: Bundled template changed without a new version

- **WHEN** `templates-html/love-days/index.html` or the bootstrap changes and
  `templates-html/love-days/artifact.lock.json` is not updated with a new version
- **THEN** the test suite fails

#### Scenario: Missing operator

- **WHEN** the command runs without `--operator`
- **THEN** it fails with `Missing operator name.` and its usage

## MODIFIED Requirements

### Requirement: Content-addressed artifact identity

The system SHALL identify every servable template artifact by its exact template `id`, exact
`version` and a `contentHash` of 64 lowercase hexadecimal characters. For an `sdk` artifact it is the SHA-256
of the artifact's HTML document, a NUL separator, and its runtime module, in that order; for an
`html` artifact it is the artifact `contentHash` computed at import ("HTML template folder"). An artifact
release MUST be resolvable only by exact `id` and `version`; no range, alias or "latest" lookup
SHALL exist. The `sdk` artifacts available today are `memory-box-spike` version `0.1.0` and
`memory-box` version `1.1.0`, registered in the repository; every imported `html` version is
resolved from its stored `templateVersions` document and its files in object storage. A template version without a built artifact, such as the retired `memory-box`
`1.0.0`, MUST NOT resolve to an artifact.

#### Scenario: Exact version lookup

- **WHEN** artifact `memory-box-spike` version `0.1.0` or `memory-box` version `1.1.0` is requested
- **THEN** it resolves with a 64-character lowercase hexadecimal `contentHash`

#### Scenario: Unknown version

- **WHEN** artifact `memory-box-spike` version `0.2.0`, or `memory-box` version `1.0.0` or `1.1`,
  is requested
- **THEN** no artifact is resolved

#### Scenario: Registry serves the committed release

- **WHEN** artifact `memory-box` version `1.1.0` is resolved
- **THEN** its files are the committed files of `templates/memory-box/releases/1.1.0/` and its
  `contentHash` equals that directory's `artifact.json` `contentHash`

#### Scenario: Imported html version lookup

- **WHEN** artifact `love-days` version `1.0.0` is requested after `db:seed`
- **THEN** it resolves with the stored `artifactContentHash` as its `contentHash`, and a version
  that was never imported resolves to no artifact

### Requirement: Artifact route

The system SHALL serve artifact files with `GET` at
`/template-artifacts/{templateId}/{version}/{contentHash}/{fileName}`. A file MUST be served only
when an artifact exists for the exact `templateId` and `version`, that version is not killed
(`template-version-controls`), the path `contentHash` equals that artifact's `contentHash`, and
`fileName` is one of the artifact's files. `fileName` is a path of 1 to 6 `/`-separated segments,
each made of `A-Z a-z 0-9 . _ -` and neither starting nor ending with `.`. The allowed file names
of an `sdk` artifact are `index.html`, served as `text/html; charset=utf-8`, and `runtime.mjs`,
served as `text/javascript; charset=utf-8`. The allowed file names of an `html` artifact are its
stored files (`index.html`, `love-gift.js`, `script-{n}.js` and `assets/...`), served from object
storage with their stored content type, and only while their bytes match the recorded SHA-256;
a file missing from storage answers like an unknown file. Any other request under this path MUST return HTTP 404 with an
empty body.

#### Scenario: Serving the entry document and module

- **WHEN** `index.html` or `runtime.mjs` of `memory-box-spike` `0.1.0` is requested with the correct
  `contentHash`
- **THEN** the response is HTTP 200 with the file body and its content type

#### Scenario: Stale or wrong hash

- **WHEN** the request uses a `contentHash` that does not match the artifact (for example 64 zeros)
- **THEN** the response is HTTP 404

#### Scenario: Unknown file or version

- **WHEN** the request names a file outside the allowed set (for example `private.txt`) or an
  unknown version (for example `9.9.9`)
- **THEN** the response is HTTP 404

#### Scenario: Killed version

- **WHEN** `index.html` of `memory-box` `1.1.0` is requested with its correct `contentHash` after an
  admin killed that version
- **THEN** the response is HTTP 404 with an empty body, and after a restore it is served again

#### Scenario: Serving an html template asset

- **WHEN** `assets/fonts/patrick-hand-latin.woff2` of `love-days` `1.0.0` is requested with the
  correct `contentHash`
- **THEN** the response is HTTP 200 with the stored bytes, `Content-Type` `font/woff2` and the
  template headers

#### Scenario: Tampered or unsafe html file path

- **WHEN** a stored file's bytes no longer match its recorded SHA-256, its object is missing from
  storage, or the path contains `..`,
  `%`, a `\` or more than 6 segments
- **THEN** the response is HTTP 404 with an empty body

### Requirement: Network-denying artifact CSP

The system SHALL send artifact responses, and every response under `/template-artifacts/` and
`/template-spikes`, with the template Content Security Policy:
`default-src 'none'`, `base-uri 'none'`, `connect-src 'none'`, `font-src` limited to the
`/template-artifacts/` path of the artifact origin (the origin of `APP_URL`; when `APP_URL` is
unset, the request's `Host` if it is a plain host name, IPv4 or bracketed IPv6 literal with an
optional port that forms a valid origin, else the request URL's origin), `form-action 'none'`, `frame-ancestors 'self'`, `img-src data:`
plus that `/template-artifacts/` path and `https://*.private.blob.vercel-storage.com`, the configured asset origin when one is set, and the
local object route source (the local storage origin followed by `/api/local-object-storage/`) when
the `local` storage driver is active (see `local-object-storage`),
`media-src 'none'`, `object-src 'none'`, `script-src 'self'`, `style-src 'unsafe-inline'` and
`worker-src 'none'`. Artifact code MUST therefore be unable to open network connections, submit
forms, load media or workers, or be framed by another origin. It MAY load fonts and images only
from the `/template-artifacts/` path (its own files, for example the bundled fonts and sample
photos of an `html` template), from `data:` URLs and from the signed asset URLs above, never from
another route of the application. Responses under `/template-artifacts/` SHALL also carry
`sandbox allow-scripts`, so an artifact opened as a top-level page runs in an opaque origin.

#### Scenario: Artifact denies network access

- **WHEN** a valid artifact file is fetched
- **THEN** its `Content-Security-Policy` contains `connect-src 'none'` and `default-src 'none'`

#### Scenario: Artifact may show locally stored images

- **WHEN** a valid artifact file is fetched while `STORAGE_DRIVER` is `local` and `APP_URL` is
  `http://127.0.0.1:3100`
- **THEN** its `img-src` contains `http://127.0.0.1:3100/api/local-object-storage/` and not the
  bare origin `http://127.0.0.1:3100`
- **AND** it still contains `connect-src 'none'`

#### Scenario: Runtime attempts an unexpected request

- **WHEN** the reference artifact runs in the Viewer
- **THEN** the only subresource requested from the artifact frame is its `runtime.mjs` module

#### Scenario: Html template loads its bundled font

- **WHEN** a valid artifact file is fetched
- **THEN** its policy contains `font-src https://<artifact origin>/template-artifacts/`,
  `sandbox allow-scripts`, and still `connect-src 'none'` and `media-src 'none'`

#### Scenario: Artifact opened as a page

- **WHEN** a person opens `/template-artifacts/love-days/1.0.0/{contentHash}/index.html` directly
- **THEN** the template runs in an opaque origin (`window.origin` is `null`) with its defaults
  and its bundled font

#### Scenario: Malformed Host header

- **WHEN** `APP_URL` is unset and a request carries the `Host` `x;foo` or one with spaces
- **THEN** the policy names the request URL's origin and never the header's text
