# Tasks

## 1. Manifest contract: steps and captioned image lists (template-sdk)

- [x] 1.1 Add `CaptionedImageListFieldSchema` (`aspectRatio`, `minItems`, `maxItems`, `captionMaxLength` 1–200, strict, `minItems <= maxItems`) to `TemplateFieldSchema` in `packages/template-sdk/src/manifest.ts`; verify `manifest.test.ts` cases for a valid 4:5 3–8/140 field, `0:0`, `minItems > maxItems`, missing/0/201 `captionMaxLength` pass
- [x] 1.2 Add the optional `steps` key (1–8 strict `{ id, label 1–40, fieldIds 1–40 }`) with exact-coverage refinement (unknown, duplicated or unassigned field ids, duplicate step ids) and export `resolveTemplateSteps(manifest)` returning the declared steps or the default `content` / `Nội dung` step; verify tests for every "Studio steps" scenario plus "Optional steps key" and "Unknown top-level key"
- [x] 1.3 Extend `createFieldValueSchema` in `payload.ts` with the `captionedImageList` item schema (strict `{ assetId: uuid, caption?: trimmed 1..captionMaxLength }`, bounds, unique `assetId`) and narrow `audio` to the kebab-case slug schema (1–80); verify `payload.test.ts` covers "Captioned images normalized", "Rejected captioned images", "Audio track id format" and that the draft variant still accepts `{}`
- [x] 1.4 Export `isImageField(field)` and `listImageFieldReferences(manifest, content)` (returns `{ fieldId, assetIds }` for `imageList` and `captionedImageList`) from the SDK index; verify unit tests for both field types, omitted fields and empty lists
- [x] 1.5 Remove the placeholder `audio` value from `templates/memory-box-spike/preview.fixture.json` (and any mirrored spike fixture constants) so the fixture satisfies the narrowed contract; verify `corepack pnpm build:templates` and `test/template-budgets.test.ts` pass

## 2. Licensed audio catalog

- [x] 2.1 Create `packages/domain/src/audio/licensed-audio-catalog.ts` with `LicensedAudioTrackSchema` (id, title, artist, durationSec, `active`/`withdrawn` status, license kind/reference/attribution, file name/mimeType/bytes/sha256 with the `{id}.{sha256[0..16]}.{mp3|m4a}` rule, unique ids), an initially empty ordered track list parsed at module load, `findLicensedAudioTrack(id)` and `listSelectableLicensedAudioTracks()`; export via `packages/domain/src/index.ts`; verify domain tests using injected fixture lists cover "Valid track", "Duplicate id or malformed record", "Empty catalog", "Withdrawn track still resolvable" and "Unknown id"
- [x] 2.2 Add `LicensedAudioTrackDtoSchema` (exactly `id`, `title`, `artist`, `durationSec`, `url`) to `packages/contracts`; verify a contract test rejects extra keys such as `license`
- [x] 2.3 Add `apps/web/src/modules/audio/application/audio-catalog.ts` mapping selectable tracks to DTOs with `url` `/audio-library/{fileName}` and exposing `isSelectableAudioTrack(id)`, plus an application port consumed by gifts and wired in `apps/web/src/composition`; verify unit tests for "Active tracks only" with a fake catalog (no `license` in the DTO, withdrawn omitted)
- [x] 2.4 Add the `/audio-library/:path*` entry setting `Cache-Control: public, max-age=31536000, immutable` to `apps/web/next.config.ts` and create `apps/web/public/audio-library/` (tracked with `.gitkeep`); verify a config unit test asserts `headers()` returns that entry alongside the global `X-Content-Type-Options: nosniff`, and a Playwright production-build check asserts `/audio-library/not-a-track.0000000000000000.mp3` returns `404` (the 200/header scenario is asserted in E2E once the first real track exists, see Out of scope)
- [x] 2.5 Add `test/audio-library.test.ts` that checks every catalog track's file exists in `apps/web/public/audio-library/` with the recorded `bytes` and `sha256`, fails on unreferenced files (ignoring `.gitkeep`) and treats a missing directory as empty; verify it passes on the empty catalog and fails in a unit case with a tampered, missing and orphaned file
- [x] 2.6 Extend `test/template-budgets.test.ts` to fail when a preview fixture's `audio` value is not a catalog track id, naming the template and id; verify with a unit case for an unknown id and a passing run on the spike

## 3. Server rules: drafts, uploads and catalog summary

- [x] 3.1 Replace the inline `imageList` reference collection in `gift-service.ts` with `listImageFieldReferences` so `captionedImageList` assets get the same existence/ownership/field/status check; verify `gift-service.test.ts` covers "Captioned image not owned by this gift field" and "Captions stored trimmed"
- [x] 3.2 Validate `audio` values in `updateDraft` through the audio catalog port, returning `INVALID_CONTENT` with a `fieldErrors` entry for unknown or withdrawn ids; verify tests for "Unknown or withdrawn audio track" and "Active audio track"
- [x] 3.3 Accept `captionedImageList` fields in `media-service.ts` upload initialization via `isImageField` and use their `maxItems` for the per-field quota; verify `media-service` tests cover "Captioned image field accepts uploads", "Field that does not accept images" and the field quota for a captioned field (the existing `media-route-handlers` test keeps `INVALID_FIELD` → `422`)
- [x] 3.4 Derive `imageRequirement` from the first `imageList` or `captionedImageList` field in `mongo-template-catalog.ts` and `seed-template-catalog.ts`; verify catalog tests for "Template with a captioned image field" and "Template without an image field"
- [x] 3.5 Add regression tests along the PATCH path for editing a draft whose template version is `draft`-status: the template repository never resolves it for editing, the service answers `INVALID_STATE` without changing the draft, and the route helper maps that to `409` with code `CONFLICT`; verify they pass without production code changes (spec fix only)
- [x] 3.6 Add a test that a `captionedImageList` item carrying a `url` key is rejected as `INVALID_CONTENT` without changing the draft (mapped to `400` `VALIDATION_ERROR` by the route helper test); verify it passes

## 4. Studio inputs

- [x] 4.1 Add the optional `captionMaxLength` mode to `MediaImageListField`: caption input per image labelled `Chú thích ảnh {n}`, remaining-count, captions keyed by `assetId`, blank captions omitted, captions seeded from saved items, dropped on delete/cancel, kept on reorder; bare `imageList` keeps reporting `string[]`; verify `media-image-list-field.test.tsx` covers every "Per-image captions" scenario and "Captioned field seeded from saved content", and existing image field tests still pass
- [x] 4.2 Render `captionedImageList` in `draft-editor.tsx` through that field and render `audio` as a select of `Không dùng nhạc` plus catalog DTOs (title · artist), `Chưa có nhạc để chọn` when empty, and a disabled unavailable option for a stored non-selectable id; pass the DTO list from the Studio server page; verify component tests for "Choose a music track", "Empty audio catalog" and "Stored track withdrawn"

## 5. Documentation

- [x] 5.1 Update `docs/templates/memory-box-storyboard.md` to the v1.1 input contract from design D7 (field table, steps, 3–8 photos at 4:5 with 140-character captions, `memory-box@1.1.0` replacing retired `1.0.0`, scene mapping to captions); verify the table matches design D7 and `corepack pnpm format:check` passes
- [x] 5.2 Add a short "Licensed audio catalog" section to `docs/architecture.md` (catalog location, how to add or withdraw a track, integrity gate, why files are public static rather than Blob, pointer to ADR-0003) ; verify links resolve and `format:check` passes

## 6. Verification and archive

- [x] 6.1 Run `corepack pnpm verify:local` and confirm it passes (secrets, spec:check, format, lint, types, coverage, audit, build, installed-Chrome E2E); record any step that cannot run locally and why
- [x] 6.2 Archive the change with `/opsx:archive change-template-contract-for-studio` in the same PR, remove the `modifiedBodyDrop` waiver for this change from `openspec/gate-exceptions.json`, and verify `corepack pnpm spec:check` passes afterwards

## Out of scope

- Seeding `memory-box@1.1.0`, building its artifact and retiring `memory-box@1.0.0` (`add-memory-box-template`).
- Step navigation, autosave, counters and client-side validation for all fields (`add-schema-driven-studio`).
- Playing catalog audio in preview or the published Viewer (`add-gift-preview`, `add-temporary-gift-publish`).
- Adding real licensed tracks; this is a data-only edit once the Product Owner supplies files and license references.
- Behavior of published gifts whose track is later withdrawn.
