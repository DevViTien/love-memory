# Proposal

## Why

Sprint 3 (plan.md §12, Gate M2) needs a real "Hộp ký ức" release, a step-based Studio, preview and
a temporary publish. Several of those need things the template contract cannot express today:

- There is no caption per photo. `imageList` values are bare asset UUIDs.
- There is no way to group fields into Studio steps. `fields` is a flat list and unknown manifest
  keys are rejected.
- An `audio` value is any 1–160 character string. No licensed audio catalog exists to pick from or
  to play.

This change settles the contract first, so the template (change `add-memory-box-template`) and the
Studio (change `add-schema-driven-studio`) build on one agreed shape instead of each inventing
their own. It also fixes a spec inconsistency found during Sprint 3 planning:
`template-catalog` names an `INVALID_STATE` error code that the API envelope does not have.

## What Changes

- Add the manifest field type `captionedImageList`. It takes `aspectRatio`, `minItems`, `maxItems`
  and `captionMaxLength`, and its value is an ordered list of `{ assetId, caption? }` items. The
  existing `imageList` value shape does not change.
- Add an optional top-level manifest key `steps`: an ordered list of `{ id, label, fieldIds }` that
  assigns every field to exactly one Studio step. A manifest without `steps` is read as a single
  step that holds every field in declaration order.
- **BREAKING (SDK contract):** narrow the `audio` field value from any 1–160 character string to a
  kebab-case track id. Saving a draft additionally requires that id to name an `active` track in
  the licensed audio catalog. No seeded template has an `audio` field and the spike template is not
  seeded, so no stored data is affected.
- Introduce a code-owned licensed audio catalog. Each track has immutable metadata, license
  provenance and a content-addressed file. Track files are served as public static files under
  `/audio-library/` with immutable caching. Browsers receive only a track DTO, never license
  records.
- Treat `captionedImageList` like `imageList` everywhere media is involved:
  - upload initialization and per-field quotas;
  - draft reference validation;
  - the catalog photo requirement;
  - the Studio image field, which gains a caption input per image.
- Let the Studio audio field pick a track from the catalog or clear it. The field keeps working
  when the catalog is empty.
- Fix `template-catalog`: editing a draft pinned to a `draft`-status version is refused with `409`
  `CONFLICT`, which matches `gift-drafts` and the code. It no longer names `INVALID_STATE`.
- Update `docs/templates/memory-box-storyboard.md` to the agreed "Hộp ký ức" v1.1 input contract:
  - 3–8 photos at 4:5, each with a caption;
  - the fields grouped into steps;
  - `memory-box@1.1.0` replaces `memory-box@1.0.0`, which will be retired and never edited.

This change belongs to **Sprint 3, Gate M2**. It is the first of the Sprint 3 changes, in this
order:

1. `change-template-contract-for-studio` (this change)
2. `add-memory-box-template`
3. `add-schema-driven-studio`
4. `add-gift-preview`
5. `add-temporary-gift-publish`
6. `add-funnel-analytics`

## Non-goals

- Building, seeding or registering the `memory-box@1.1.0` artifact and manifest, and retiring
  `memory-box@1.0.0`. These belong to `add-memory-box-template`, so that the manifest and the
  artifact ship together as one immutable release.
- Step navigation UI, client-side schema validation, counters, autosave, the conflict UX and the
  Zustand store. These belong to `add-schema-driven-studio`. This change only keeps the existing
  flat editor rendering one input per field.
- Playing catalog audio in the Viewer or preview, and resolving track URLs into Viewer payloads.
  These belong to `add-gift-preview` and `add-temporary-gift-publish`.
- Deciding what happens to already published gifts when a track is withdrawn. This change defines
  only the `withdrawn` status and blocks new selection.
- Supplying real licensed tracks. The catalog may be empty. Populating it is a Product Owner
  dependency for Gate M2 (see design Open Questions).
- Bumping `TEMPLATE_ENGINE_VERSION`. The host↔template protocol does not change.

## Capabilities

### New Capabilities

- `licensed-audio-catalog`: the code-owned catalog of licensed music tracks, covering:
  - track identity and immutability;
  - license provenance;
  - `active`/`withdrawn` status;
  - content-addressed static file delivery with immutable caching;
  - the browser track DTO;
  - the CI check that catalog files exist and match their recorded hash and size.

### Modified Capabilities

- `template-manifest-contract`:
  - the optional `steps` top-level key;
  - the `captionedImageList` field type;
  - `captionedImageList` and track-id `audio` payload validation;
  - the CI gate checking that preview fixture audio values name catalog tracks.
- `template-catalog`:
  - the photo requirement also derives from `captionedImageList`;
  - the draft-status edit refusal is `409` `CONFLICT`.
- `gift-drafts`:
  - content validation for `captionedImageList` (asset ownership and captions) and for audio
    catalog membership;
  - the editor renders captioned image and audio track inputs.
- `media-upload`:
  - upload initialization, quotas and asset references accept `captionedImageList` fields.
- `studio-image-list-field`:
  - the field also renders `captionedImageList` fields, with one caption input per image.

## Impact

- **Invariants touched**:
  - _Validate untrusted input at every entry_: new field values are validated by the manifest-derived
    Zod schema, and track membership is checked on the server when saving.
  - _Gift documents reference media by asset ID only_: `captionedImageList` stores `assetId` UUIDs
    plus caption text, never URLs or keys.
  - _Storage keys and raw Blob URLs never reach the browser_: audio files are public static
    catalog content, not user media, and the DTO exposes only a same-origin path.
  - _Never store image/audio bytes in MongoDB_: gifts store only a track id; audio bytes live in
    static files.
  - _Audio never autoplays; a no-audio path always exists_: `audio` stays optional, the catalog
    may be empty, and playback rules are unchanged.
  - _A template release is immutable once referenced_: `memory-box@1.0.0` is not edited. The new
    contract is used by a new version in the next change.
- **Code**:
  - `packages/template-sdk`: `manifest.ts`, `payload.ts`, a new steps helper, tests.
  - `packages/domain`: new `audio/` catalog module.
  - `packages/contracts`: a track DTO.
  - `apps/web/src/modules/gifts`: content and reference validation, `draft-editor.tsx`.
  - `apps/web/src/modules/media`: field-type checks in `media-service.ts` and
    `media-image-list-field.tsx`.
  - `apps/web/src/modules/templates`: `mongo-template-catalog.ts`, `seed-template-catalog.ts`.
  - `apps/web/next.config.ts`: `/audio-library` headers.
  - `test/template-budgets.test.ts` and a new `test/audio-library.test.ts`.
  - `templates/memory-box-spike/preview.fixture.json`.
- **Docs**: `docs/templates/memory-box-storyboard.md`.
- **APIs**: no new routes. `POST /api/media/uploads/init` and `PATCH /api/gifts/{publicId}` accept
  the new field type. The static path `/audio-library/{fileName}` is added.
- **Data**: no collection, validator, index or migration change. `DATABASE_SCHEMA_VERSION` stays
  `6`.
- **Dependencies**: none added.
