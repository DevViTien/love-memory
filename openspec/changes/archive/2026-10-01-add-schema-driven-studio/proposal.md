# Proposal

## Why

Sprint 3 (plan.md §12.1, Gate M2) needs a Studio that a non-technical creator can finish on a
phone. Today `/studio/{publicId}` renders every field in one flat form, ignores the manifest
`steps`, shows a static step bar that does not navigate, validates nothing until the creator
presses `Lưu nội dung`, and loses work silently when the creator forgets to save or closes the
tab. A second tab that saves first only produces a "reload the page" message.

The template contract already carries what the Studio needs: `steps`, field limits and the draft
payload schema (archived change `change-template-contract-for-studio`). Preview "Sửa" links
(`add-gift-preview`) and the Gate M2 journey (`add-funnel-analytics`) depend on a Studio with
addressable steps and fields, so this change comes second in Sprint 3.

## What Changes

- Group the editor into the steps resolved from the bound manifest (`resolveTemplateSteps`), then
  two Studio-level steps `Xem trước` and `Xuất bản`. The active step lives in the URL
  (`?step=<stepId>`). A deep link `?field=<fieldId>` opens the step that holds the field and focuses
  it. The Studio-level steps show a readiness summary now; their actions arrive with
  `add-gift-preview` and `add-temporary-gift-publish`.
- Validate on the client with the same draft rules as the server, show a completion state per
  step (full payload rules), character counters for text fields and an image count for image
  fields, and show inline field errors. Server `fieldErrors` are mapped to fields by their first
  path segment.
- Hold the editor state (content, revision, save status, field errors, conflict) in a per-editor
  Zustand store. Add `zustand` to `apps/web`.
- Replace the manual save with a debounced autosave: 1500 ms after the last change, at most one
  request in flight, latest content wins, unchanged content never sent. Status messages
  `Đã lưu`, `Đang lưu…`, `Chưa lưu được — thử lại` and `Mất kết nối — sẽ lưu khi có mạng`, with a
  retry when the browser comes back `online`. Keep a `Lưu ngay` button. Warn on `beforeunload`
  while anything is unsaved.
- On a `409` revision conflict, stop autosave and let the creator choose `Tải bản mới nhất`
  (discard local changes, load the stored draft) or `Giữ bản của tôi` (save the local content
  against the server's actual revision). Nothing is resolved automatically.
- Image field changes are persisted by autosave instead of waiting for a manual save. Each image
  field shows its image count.
- Let a draft hold fewer images than a field's `minItems`. Today the draft payload schema enforces
  `minItems`, so the first photo of the 3-photo "Hộp ký ức" field would make every autosave fail.
  `minItems` stays enforced by full payload validation (step completeness, preview issues,
  publish).
- Reserve the step ids `preview` and `publish` for the Studio-level steps so a manifest step can
  never shadow them in the URL.
- **BREAKING (UI copy):** the editor no longer shows `Lưu nội dung` or `Revision {n}`. The existing
  Playwright draft journey is updated accordingly.

This change belongs to **Sprint 3, Gate M2**, second of six: `add-memory-box-template`,
`add-schema-driven-studio` (this change), `add-local-object-storage`, `add-gift-preview`,
`add-temporary-gift-publish`, `add-funnel-analytics`.

## Non-goals

- The preview action, preview tokens and the issues panel (`add-gift-preview`). The publish
  action, the published-gift panel and the share link (`add-temporary-gift-publish`). This change
  only shows those two steps with a readiness summary and a disabled action.
- Undo/redo, field-level history and automatic or manual merging of conflicting edits. A conflict
  is resolved by keeping one whole version.
- Presence or live collaboration between tabs or devices.
- A retention policy for `giftRevisions`. Autosave keeps writing one snapshot per successful save;
  pruning belongs to Sprint 6 hardening.
- Offline persistence across reloads (IndexedDB drafts). Unsaved content survives network loss
  only while the page stays open.
- Funnel events such as `customization_started` (`add-funnel-analytics`).
- React Hook Form. The store and the SDK schemas cover the Studio; tech-stack.md lists RHF, but no
  production code would need it yet (see design D2).

## Capabilities

### New Capabilities

- `studio-editor`: how the Studio presents a draft for editing:
  - steps from the manifest plus the Studio-level `Xem trước` and `Xuất bản` steps;
  - URL addressing of steps and deep links to fields, with focus management;
  - per-type inputs with character and image counters;
  - client-side validation and inline field errors, including mapped server `fieldErrors`;
  - per-step completion state and the readiness summary.
- `studio-autosave`: how the Studio persists a draft:
  - debounced, single-flight, latest-wins autosave and the `Lưu ngay` action;
  - the save status messages, retry and offline behavior;
  - the unsaved-changes navigation warning;
  - explicit revision conflict resolution.

### Modified Capabilities

- `gift-drafts`:
  - "Content validation against template fields": draft image lists may hold fewer than
    `minItems` items;
  - "Revision numbers and optimistic concurrency": the Studio resolves conflicts explicitly instead
    of asking for a page reload;
  - "Studio draft creation and editing flow": steps, autosave and the audio field's inline error
    replace the manual save and the revision label.
- `template-manifest-contract`:
  - "Payload validation against fields": the draft variant does not enforce `minItems`;
  - "Studio steps": step ids `preview` and `publish` are reserved.
- `studio-image-list-field`:
  - "Field rendering from the template manifest": changes are persisted by autosave, and the field
    shows its image count.

## Impact

- **Invariants touched**:
  - _Validate untrusted input at every entry_: client validation is only for guidance. The server
    still validates every `PATCH` with the draft schema, the audio catalog and asset ownership.
    The relaxed `minItems` rule is still enforced by full payload validation before anything is
    shown to a recipient.
  - _Gift documents reference media by asset ID only_: autosave sends the same content shape as
    before: asset UUIDs and captions, never URLs.
  - _Protected gift payloads never enter public caches; private routes use nonce CSP_:
    `/studio/{publicId}` keeps its nonce CSP and `connection()` layout. `?step` and `?field` do not
    change caching. No new route is added, and Zustand needs no `eval`, so the CSP is unchanged.
  - _Never log gift text_: autosave errors are not logged with content, and the store is never
    persisted to `localStorage`.
  - _Authorize inside the data-access filter; opaque 404_: autosave and the reload action use the
    existing `PATCH` and `GET /api/gifts/{publicId}`, and a `404` stops autosave without revealing
    anything.
- **Code**:
  - `packages/template-sdk`: `payload.ts` (draft schema without `minItems`), `manifest.ts`
    (reserved step ids), tests.
  - `apps/web/src/modules/gifts/presentation`: `draft-editor.tsx` becomes the Studio editor shell.
    A new `studio/` folder holds pure `.ts` modules (steps, validation, store, save request,
    autosave controller) with tests, and small `.tsx` components.
  - `apps/web/src/modules/media/presentation/media-image-list-field.tsx`: the image count.
  - `apps/web/src/app/studio/[publicId]/page.tsx`: the static step bar is removed.
  - `apps/web/e2e/home.spec.ts` (draft journey) and a new `apps/web/e2e/studio.spec.ts`.
  - `docs/architecture.md`: a short Studio editor section.
- **APIs**: no new or changed routes. The Studio uses `PATCH /api/gifts/{publicId}` and
  `GET /api/gifts/{publicId}`. `PATCH` now accepts image lists shorter than `minItems`.
- **Rate limits**: autosave stays within `gift-update` (60 requests per 60 seconds per subject);
  see design D6.
- **Data**: no collection, validator, index or migration change. Autosave increases the number of
  `giftRevisions` documents per draft; retention is deferred (Non-goals).
- **Dependencies**: `zustand` (production dependency of `apps/web`, pinned in the pnpm catalog).
