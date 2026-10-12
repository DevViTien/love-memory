# Add the html template kind

## Why

The product direction changed on 2026-10-13 ([plan.md §1.1](../../../plan.md)). Templates become
admin-managed data: single-page HTML animations, like the `animation-gift` collection, whose
configurable values live in one `CONFIG` object. A creator fills that configuration in the Studio,
and the output is the gift page and its QR code.

Today a template is code built in the repository (`sdk` kind, `memory-box`). Adding one means a
workspace, a build and a committed release. This is change 1 of
[the template pivot plan](../../../docs/sprints/template-pivot-plan.md) (decisions T1–T7 and the
first template of T9). It replaces Sprint 4's templates 2 and 3 (plan.md §13.4, §13.5). It proves
the new kind end to end with `love-days` (`Trái tim yêu thương`), from the catalog to `/g/{shareId}`.

## What Changes

- **Template kinds.** A manifest gains `kind` (`sdk` or `html`; absent means `sdk`, so existing
  manifests stay valid). For `html`, every field except `audio` has a `path`: a dot path into the
  template's configuration. The host keeps playing the licensed music (T5).
- **Four new field types** (T6): `textList` (lines of short text), `image` (one photo), `passcode`
  (4–8 digits, a playful lock, never access control) and `color` (`#rrggbb`). They are covered by:
  - SDK value schemas, draft and full;
  - the Studio inputs;
  - content issues and the static fallback;
  - media upload binding and quotas;
  - the photo count of plans.
- **Authoring format** (T2): a folder with `index.html`, whose defaults sit in
  `<script type="application/json" id="gift-config">`, plus `template.json` (manifest with paths),
  `assets/` (bundled fonts, sample photos, thumbnail) and optional documentation.
- **Importer** (T3, T4):
  - It checks the folder and refuses inline handlers, `javascript:` and external URLs, `<link>`,
    `<iframe>`, `<object>`, `<embed>`, `<form>`, `<base>` and `<meta http-equiv>`.
  - It moves inline scripts into files and injects the `LoveGift` bootstrap.
  - It measures the budgets, computes a content-addressed hash, and stores the files in object
    storage and the version in `templateVersions` (immutable).
  - It records `admin.template.imported`.
  - It runs as `pnpm template:import <folder> --operator <name> [--publish]`; `db:seed` imports
    every folder under `templates-html/`.
- **Delivery.** Artifact resolution becomes kind-aware: `sdk` from the repository, `html` from
  MongoDB and storage. The artifact route takes file paths (`assets/fonts/...`). The template CSP
  allows fonts and images only from `/template-artifacts/`, and artifact responses carry
  `sandbox allow-scripts`; `connect-src` and `media-src` stay `'none'`. The gift viewer treats a
  second load of the template frame as a navigation: it never posts to that window again and falls
  back to the static rendering (`NAVIGATED`).
- **Runtime.** `love-gift.js` does three things:
  - it receives `INIT`, merges the gift's values into the defaults by path, and answers `READY`;
  - it exposes `window.LoveGift` (`config`, `reducedMotion`, `complete`, `scene`);
  - it runs the template's scripts on the first `PLAY` (`Mở quà`), turns later `PAUSE` and `PLAY`
    into `lovegift:*` events, and answers `ERROR` when a script fails.

  Only a top-level open starts by itself, with the defaults, so authors can preview a template.

- **First catalog entry:** `templates-html/love-days`, ported from `animation-gift`. Its Patrick
  Hand font is bundled under the OFL, with sample assets.
- **Schema version `19`**: `templateVersions` validates `kind`, `files`, `defaults`,
  `artifactContentHash` and `importedAt`.

## Capabilities

### New Capabilities

None. The new requirements extend existing capabilities.

### Modified Capabilities

- `template-manifest-contract`: "Manifest identity, version and status" (`kind`), "Field
  definitions" and "Payload validation against fields" (new types); adds "Configuration paths of
  html templates".
- `template-artifact-delivery`: "Content-addressed artifact identity", "Artifact route" and
  "Network-denying artifact CSP"; adds "HTML template folder" and "HTML template import command".
- `template-viewer-runtime`: "Asset URL allowlist injection"; adds "HTML template bootstrap".
- `template-catalog`: "Template summary is derived from the stored manifest" and "Seeded launch
  templates".
- `viewer-payload`: "Asset URL selection", "Field summaries" and "Content issues".
- `gift-viewer`: "Static fallback keeps the content".
- `content-security-policy`: "Isolated template document policy".
- `studio-editor`: "Field inputs and counters".
- `studio-image-list-field`: "Field rendering from the template manifest".
- `gift-drafts`: "Content validation against template fields".
- `media-upload`: "Upload initialization" and "Atomic per-gift and per-field quotas".
- `gift-plans`: "Plan catalog" (photo count).
- `audit-log`: "Audit records" (`admin.template.imported`).
- `database-schema-management`: "JSON-schema validators", "Idempotent migration with ledger",
  "Schema verification" and "Template catalog seed".

## Non-goals

- An admin page to upload, preview, publish and retire `html` templates (plan.md §17.4 P1).
- QR codes (`add-gift-qr-codes`, change 2).
- The five other `animation-gift` templates and catalog thumbnails from template files
  (`add-animation-gift-templates`, change 3).
- The Viewer harness (`/viewer/...`) for `html` templates; it stays a diagnostic page for `sdk`
  fixtures.
- A server-side access password; `passcode` does not replace it.
- User-uploaded music.
- Retiring `our-timeline` and `midnight-wish` from the seed.

## Impact

- **Code:**
  - `packages/template-sdk`: manifest and payload;
  - `packages/contracts`: viewer field types;
  - `packages/database`: schema version `19`;
  - `modules/templates`: importer, bootstrap, storage-backed artifacts, seed;
  - the artifact route (catch-all) and the template CSP;
  - viewer content issues and the static fallback;
  - the Studio field inputs and media quotas;
  - the audit action;
  - `scripts/template-import.ts` and `db:seed`;
  - CI (`db:seed` with the local storage driver).
- **Dependency:** `parse5` (already in the lockfile through jsdom) for the importer's HTML checks.
- **Operations:**
  - `db:migrate` to schema version `19`;
  - `db:seed` and `template:import` need the tier's object storage configured;
  - the deployment runbook gains the seed and import steps.
- **Invariants:**
  - _Template code runs in `sandbox="allow-scripts"` without network access._ Unchanged iframe;
    the CSP still denies `connect-src`, `media-src`, forms and workers, and adds only
    `/template-artifacts/` for fonts and images plus `sandbox allow-scripts` for a direct open. The
    importer's refusals (external URLs, inline handlers, navigation) are a lint and a defence in
    depth. The trust boundary is the sandbox, the CSP, the host's checks (including navigation) and
    the operator's review of imported HTML.
  - _The host accepts only schema-valid messages from that exact iframe._ Unchanged: the bootstrap
    posts only protocol events, and the host validates them as before.
  - _A template release is immutable._ An `html` version is content-addressed; a different folder
    under the same version is refused, and a stored version never changes.
  - _Gifts reference media by asset ID only; storage keys never reach the browser._ The payload
    keeps asset ids; the bootstrap receives only the signed `INIT` `assets` URLs. Template storage
    keys stay on the server.
  - _No image bytes in MongoDB._ Template files go to object storage; MongoDB holds their names,
    hashes and storage keys.
  - _Audio starts only from a user gesture._ The host still plays the licensed track; html
    templates get no music path.
