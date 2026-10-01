# Design

## Context

See proposal.md for why this change exists. Today:

- `packages/template-sdk/src/manifest.ts` defines six field types in a Zod discriminated union.
  The manifest object is `.strict()`.
- `payload.ts` derives the full and draft payload schemas from `fields`.
- The server enforces field-type-specific rules in two places:
  - `apps/web/src/modules/gifts/application/gift-service.ts` collects `imageList` asset
    references and checks their ownership through `validateMediaReferences`.
  - `apps/web/src/modules/media/application/media-service.ts` refuses upload initialization unless
    `field.type === "imageList"` and passes `field.maxItems` into the quota reservation.
- The catalog summary (`mongo-template-catalog.ts`, `seed-template-catalog.ts`) derives
  `imageRequirement` from the first `imageList` field.
- In the Studio, `draft-editor.tsx` renders `audio` as a placeholder box.
  `MediaImageListField` reports `onChange(fieldId, assetIds)`.

No licensed audio exists in the repository. `apps/web/public/` does not exist. Next.js 16 serves
`public/` files with `Cache-Control: public, max-age=0` unless `next.config.ts` `headers()`
overrides it. Overriding is allowed for public files, and is not allowed only for Next's own
hashed build assets (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md`,
"Cache-Control").

Governing ADRs:

- ADR-0003 (private Blob for user media). Catalog audio is not user media and stays out of Blob.
  The ADR's Context line "Photos, audio and generated derivatives" refers to user-supplied audio
  such as future voice notes.
- ADR-0004 (immutable template artifacts). `memory-box@1.0.0` is not edited.
- ADR-0005 (route CSP modes). The app `media-src` already includes `'self'`.

## Goals / Non-Goals

**Goals:**

- Keep one source of truth for each new rule. Field-type rules live in the SDK schema, and catalog
  membership lives in the audio catalog module. Every consumer calls these instead of re-encoding
  them.
- Keep existing stored data valid without a migration.
- Keep the Studio honest to "one input per field" with the minimum UI this change needs.

**Non-Goals:**

- A generic "media field" abstraction for future video or audio uploads.
- Studio step navigation. `steps` is only parsed and resolved here; change
  `add-schema-driven-studio` consumes it.
- Streaming, preview clips or range-request tuning for audio.

## Decisions

### D1. `captionedImageList` is a new field type, not an `imageList` option

A new discriminant keeps `imageList` values as `string[]`, so existing drafts, the catalog summary
logic, the Studio seed and `media-upload` rules for bare lists do not change meaning.

- The payload item schema is `z.object({ assetId: z.uuid(), caption: trimmed 1..captionMaxLength
optional }).strict()`, plus array bounds and an `assetId` uniqueness refinement.
- The SDK exports one helper, `listImageFieldReferences(manifest, content)`. It returns
  `{ fieldId, assetIds }` for both image field types. `gift-service` uses it instead of its inline
  `imageList` switch.
- The SDK also exports `isImageField(field)`. `media-service` and both catalog summaries use it for
  the upload/quota check and for the photo requirement.

_Alternative rejected:_ an optional `captions` flag on `imageList` makes the value shape depend on a
flag. Every consumer would have to branch on it, and the manifest could not be read by type alone.

_Alternative rejected:_ a parallel `longText`/list field for captions keyed by index. Captions would
detach from their photos on reorder or delete.

### D2. `steps` is an optional top-level key with a resolver

`TemplateManifestSchema` gains `steps: StepSchema.array().min(1).max(8).optional()`, with a
`superRefine` that enforces exact coverage: each field is in exactly one step, and there are no
unknown or duplicate ids.

- `resolveTemplateSteps(manifest)` returns the declared steps, or the single default step
  `{ id: "content", label: "Nội dung", fieldIds: [...declaration order] }`.
- Making `steps` optional keeps all four existing manifests valid: three seeds and the spike. So
  `templateVersions` documents need no migration and `DATABASE_SCHEMA_VERSION` stays `6`.

_Alternative rejected:_ a per-field `step` key. Step labels and step order would then need a second
list anyway, and it is harder to validate that the steps are complete.

### D3. Audio catalog lives in `packages/domain/src/audio/`, files in `apps/web/public/audio-library/`

- **Domain.** `packages/domain` already depends on `zod`, and the catalog is pure data plus rules.
  - `licensed-audio-catalog.ts` holds a `LicensedAudioTrackSchema` and the ordered track array,
    parsed once at module load. A malformed catalog therefore fails at import, in tests and in the
    build.
  - It exports `findLicensedAudioTrack(id)` and `listSelectableLicensedAudioTracks()`.
  - The initial array is empty (see Open Questions).
- **Contracts.** `packages/contracts` gains `LicensedAudioTrackDtoSchema` with exactly `id`,
  `title`, `artist`, `durationSec` and `url`.
- **Web.**
  - A small `apps/web/src/modules/audio/application/audio-catalog.ts` maps domain tracks to DTOs
    and builds `url` as `/audio-library/{fileName}`. It also exposes `isSelectableAudioTrack(id)`.
  - The gifts application layer receives the catalog through a port wired in
    `apps/web/src/composition`, so its tests can inject a fake catalog.
  - The Studio page (a server component) passes the DTO list to `DraftEditor` as a prop, so no new
    API route is needed.
- **Static files.** Track files are committed under `apps/web/public/audio-library/` with
  content-hashed names.
  - `next.config.ts` adds a `headers()` entry for `/audio-library/:path*` that sets
    `Cache-Control: public, max-age=31536000, immutable`.
  - The global `/:path*` entry already sets `X-Content-Type-Options: nosniff`.
  - Next serves the correct `Content-Type` from the `.mp3` / `.m4a` extension.
  - Unknown names fall through to the normal 404.
  - The headers are verified in the Playwright production build. `next dev` may override
    `Cache-Control`, so it is not a valid place to check them.

_Alternative rejected:_ storing tracks in a MongoDB collection. That needs a migration, an admin
UI and seeding for data that changes only when a license is signed. Source control already gives
review, history and a permanent record for each license reference.

_Alternative rejected:_ a route handler like `/template-artifacts`. It would duplicate what the
static file server already does correctly. It stays the fallback if the production headers check
fails on Vercel.

_Alternative rejected:_ a public Vercel Blob store. It adds a second provider configuration for a
few MB of files. It can be revisited if the catalog grows beyond what belongs in Git (see Risks).

### D4. Draft saves reject non-selectable tracks, including already stored ones

`gift-service.updateDraft` validates each `audio` value with `isSelectableAudioTrack` after the Zod
parse and adds `fieldErrors[fieldId] = "Audio track is not available."` on failure. Rejecting a
withdrawn track that is already stored means a publish (a later change) can never snapshot a
withdrawn track. The Studio shows the stored choice as unavailable so the creator knows what to fix.

_Alternative rejected:_ silently dropping the value on save. That would change content without the
creator's action.

### D5. Minimal Studio support

- `MediaImageListField` gains an optional `captionMaxLength` prop.
  - When it is set, the field keeps a caption map keyed by `assetId`, renders one input per item
    with a remaining-count, and reports items through a new
    `onChange(fieldId, value: readonly string[] | readonly CaptionedImageItem[])` shape.
  - Reordering moves the key, and deleting the asset drops its entry.
  - Saved captions are seeded from the draft content.
- `DraftEditor` renders:
  - `captionedImageList` through that field;
  - `audio` as a `<select>` of `Không dùng nhạc` plus the DTO list, or the text
    `Chưa có nhạc để chọn` when the list is empty;
  - an unavailable stored id as a disabled `(không còn khả dụng)` option.
- No steps, autosave or counters on other fields. Those belong to `add-schema-driven-studio`.

### D6. Spec fix for `INVALID_STATE`

`gift-route-helpers.ts` already maps the service's `INVALID_STATE` to `409 CONFLICT`. Only the
`template-catalog` scenario is wrong. A route regression test pins the behavior. A
`modifiedBodyDrop` waiver in `openspec/gate-exceptions.json` records the intentional removal of the
backticked identifier.

### D7. Storyboard becomes the v1.1 input contract

`docs/templates/memory-box-storyboard.md` gets the field table, the steps and the scene mapping that
`add-memory-box-template` will encode in `memory-box@1.1.0`:

| Step (`id`, label)          | Field id           | Type                 | Rules                                                                            |
| --------------------------- | ------------------ | -------------------- | -------------------------------------------------------------------------------- |
| `recipient`, `Người nhận`   | `receiver-name`    | `shortText`          | 40, required                                                                     |
| `recipient`, `Người nhận`   | `anniversary-date` | `date`               | optional                                                                         |
| `opening`, `Lời mở hộp`     | `opening-message`  | `shortText`          | 120, required                                                                    |
| `memories`, `Kỷ niệm`       | `memories`         | `captionedImageList` | 4:5, 3–8, caption 140, required                                                  |
| `letter`, `Lá thư`          | `final-letter`     | `longText`           | 1200, required                                                                   |
| `style`, `Giao diện & nhạc` | `theme`            | `theme`              | `rose-night` / `warm-paper`, optional; the template defaults to the first option |
| `style`, `Giao diện & nhạc` | `audio`            | `audio`              | optional                                                                         |

`audio` stays optional in launch templates so an empty catalog never blocks completion.

## Risks / Trade-offs

- **The catalog stays empty at Gate M2.** Audio then cannot be demonstrated end to end.
  → Every surface has a specified empty behavior, and the no-audio path is an invariant anyway.
  The Product Owner dependency is tracked in Open Questions and in plan.md Gate M2 notes by
  `add-memory-box-template`.
- **Audio files bloat the Git repository.** → The schema caps each file at 8 MiB, and the catalog
  is expected to hold under 10 tracks for MVP. Moving to a public Blob store is the recorded
  alternative, and DTO URLs isolate callers from where the files live.
- **Production headers may differ on Vercel.** → Playwright asserts the headers against
  `next start`. The staging deploy check is added to the verification group. The route-handler
  fallback (D3) needs no spec change.
- **The `onChange` signature change in `MediaImageListField` touches the existing image field.** →
  Bare `imageList` keeps reporting `string[]`. Existing tests stay, and new tests cover the
  captioned branch.
- **Narrowing the `audio` value type is breaking.** → No stored data uses it (the seeds have no
  audio field, and the spike is not seeded). The spike fixture drops its placeholder `audio` value.

## Migration Plan

1. The SDK and domain changes ship first. They are additive, except for the `audio` value format.
2. No database migration is needed. The seed is unchanged in this change.
3. Deploy order is irrelevant because the API and Studio ship in one Next.js deployment.
4. Rollback is a revert of the deployment. No persisted data uses the new shapes until
   `memory-box@1.1.0` is seeded by the next change.

## Open Questions

- Which licensed tracks will the Product Owner provide for MVP, and under which license
  references? This does not change the specs or the tasks: adding a track is a data-only edit
  guarded by the integrity gate.
