# Add privacy notice, upload-rights confirmation and export

## Why

Several commitments are still unmet:

- **Privacy notice.** Production stays off until there is a privacy notice (PO decision P11).
- **Rights confirmation.** PO decision P4 asks for a one-line rights confirmation at publish.
- **Product promise.** idea.md promises "no-surprise privacy": before publishing, a creator knows
  who can see the gift, how long data is kept, and how to delete it.
- **Superseded publication text.** It is kept forever, which is an open row in the risk register.
- **Export.** Owners cannot export their gift.

Plan.md §15.3 and the Sprint 6 plan (change 6) cover all of these.

## What Changes

- **Privacy notice.**
  - **The page.** `/privacy` (`Chính sách quyền riêng tư`) is a static page. It states:
    - what LoveMemory stores and why;
    - who can see a gift;
    - a retention table matching the system's real behavior;
    - the cookies and browser storage it uses;
    - how to pause, delete, export and report;
    - that there is no advertising or third-party tracking.
  - **Links.** A site footer on every page links to it (`Quyền riêng tư`), and the sign-in form
    gains a one-line notice with the link.
- **Upload-rights confirmation.** Both publish confirmations (first publish and update) gain a
  required checkbox. `Xác nhận xuất bản` / `Xác nhận cập nhật` stays disabled until it is checked.
  `POST /api/gifts/{publicId}/publish` requires `rightsConfirmed: true`, and each publication record
  stores `rightsConfirmedAt`.
- **Retention labels.** The publish confirmation shows how long recipients can open the gift on the
  selected plan, and that the owner can pause or delete it at any time.
- **Superseded publications.** After an update, `gift.assets.cleanup.v1` deletes the gift's
  publication records older than the current one, with their text, once the current one is
  confirmed readable. Only the current publication is kept.
- **Owner export.** `GET /api/gifts/{publicId}/export` downloads the gift as a JSON file:
  - the metadata;
  - the working-copy content;
  - the current publication's summary;
  - the photo list, with five-minute download links.

  The Studio aside offers `Tải dữ liệu món quà`.

## Capabilities

### New Capabilities

- `privacy-notice`: the privacy page, the footer and sign-in links, the retention table, and the
  owner export.

### Modified Capabilities

- `gift-publishing`:
  - "Publish endpoint and authorization": `rightsConfirmed`;
  - "Immutable publication snapshot": `rightsConfirmedAt`, and superseded records removed by the
    cleanup job.
- `studio-editor`: "Studio preview and publish steps": the rights checkbox, the retention line and
  the request body.
- `media-upload`: "Cleanup of detached assets": the job also deletes superseded publication
  records.

## Non-goals

- **Automatic deletion of expired gifts or abandoned drafts.** Retention periods for these need a
  PO decision. Until then the privacy notice says they are kept until the owner deletes them.
- **Analytics consent.** Analytics stays off in Production (ADR-0010). Turning it on later needs a
  consent banner, which is a later change.
- **Account deletion**, and data export for a whole account.
- **Terms of service.**
- **Exporting original photos.** Originals are not kept; the export links the processed photos.

## Impact

- **Code:**
  - `packages/contracts` (`PublishGiftRequestSchema`);
  - `packages/domain` (`GiftPublication.rightsConfirmedAt`);
  - `modules/gifts` (the publish service, the publish step UI, the export route, the Studio aside);
  - `modules/media` (the cleanup job, through a publication port);
  - `app/privacy`, the root layout footer, the sign-in form.

  There is no schema version change: the publications validator allows additional properties.

- **Invariants:**
  - **Opaque 404, owner-only.** The export uses the same accessors as `GET /api/gifts/{publicId}`:
    any draft accessor for a draft, the signed-in owner otherwise. Everyone else gets `404`.
  - **Signed URLs, no storage keys.** The export holds asset ids and five-minute signed URLs only,
    and is `no-store`.
  - **Logging.** The export is never logged, and the consent is a timestamp only.
  - **Static CSP for public pages.** `/privacy` is a static public route.
  - **Immutable publication.** A publication is never modified. Superseded ones are deleted by a
    job, and never served before that either.
