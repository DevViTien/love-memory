# Proposal

## Why

Gate M2 (plan.md §12.2 and §12.7) needs two things. First, a creator must see the gift exactly as
the recipient will, before publishing: "Content preview và published giống nhau". Second, a broken
template must never hide the gift's core content: "Template lỗi không làm mất nội dung cốt lõi".

Today there is no way to render a stored draft:

- The only runtime host is the diagnostic Viewer harness, which plays fixtures.
- Nothing turns a draft's asset ids into signed image URLs, or its track id into an audio URL.
- The Studio's `Xem trước` step, added by `add-schema-driven-studio`, shows a disabled button
  with `Sắp ra mắt`.

The template `memory-box@1.1.0` (`add-memory-box-template`), the step-based Studio with
`flush()` and `?field=` deep links (`add-schema-driven-studio`), and local object storage for E2E
uploads (`add-local-object-storage`) are now in place. This change builds on all three. The
published Viewer (`add-temporary-gift-publish`) will reuse the payload builder and the host
component introduced here.

## What Changes

- Add one server-side transformer that turns a template manifest, stored content, the gift's
  asset records and the audio catalog into the Viewer input:
  - the artifact URL, or none when the version has no registered artifact or does not match an
    optional expected `contentHash`;
  - the payload (the content exactly as stored);
  - an asset map of signed URLs, for `ready` assets of this gift and field only, using the
    derivative closest to 768 px, plus `assetsExpireAt`;
  - the audio URL of a selectable track;
  - the field summaries needed for a static rendering;
  - content issues found by full (non-draft) validation and asset checks: `CONTENT_MISSING`,
    `CONTENT_TOO_FEW`, `CONTENT_INVALID` (per item where possible) and `ASSET_UNAVAILABLE`. Issues
    are creator feedback that recipient responses may omit.

  Preview uses it now, and the published Viewer must use the same transformer later.

- Add a reusable host component, the gift viewer. Its content source is either ready (preview) or
  deferred: the payload is loaded only on tap, so `/g/{shareId}` can render its envelope without
  content. It shows:
  - an envelope with a `Mở quà` tap-to-open control, which starts audio inside the gesture. A
    deferred source unlocks audio in the gesture before its load, and a failed load offers
    `Thử lại`;
  - the sandboxed template iframe. Its `src` is set only after the client `load` listener is
    attached, and `PLAY` is sent only after `READY`;
  - pause when the page is hidden, with a `Tiếp tục` control;
  - a mute control;
  - a host-rendered static fallback with all text and images. The fallback is used when the
    template sends `ERROR`, when it never becomes ready, or when no artifact exists, so the
    content is never lost. It fetches fresh image URLs once when the old ones have expired;
  - lifecycle notifications (`opened`, `scene`, `completed`, `fallback`) for its host page. The
    preview never turns them into recipient events.
- Add preview links:
  - `POST /api/gifts/{publicId}/preview` authorizes the owner, applies the mutation guards and the
    new rate-limit scope `gift-preview`, and returns `{ url: "/preview/{token}", expiresAt }`.
  - The token is 32 random bytes in base64url. Only its SHA-256 hash is stored, in a new
    `previewTokens` collection with a TTL index. The link is valid for 30 minutes and bound to the
    gift.
  - Opening the link shows the gift's current draft. An unknown, expired or non-draft link renders
    the opaque not-found page.
- Add the page `/preview/{token}`. It uses the nonce CSP (it is added to the CSP route table), its
  layout calls `connection()`, and it is sent with `Cache-Control: private, no-store`,
  `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`. It has these controls:
  - a phone/desktop viewport switch;
  - `Phát lại`, which re-reads the draft, re-signs the URLs and re-initializes the template;
  - mute;
  - a reduced-motion switch.

  An issues panel merges the server issues with the distinct template `ISSUE` events. Each issue
  has a `Sửa` link to `/studio/{publicId}?field=<fieldId>` when the browser can edit the draft.
  Otherwise the panel shows the hint `Mở Studio trên thiết bị đã tạo quà để sửa.` instead.

- A draft pinned to a version without an artifact, such as the retired `memory-box@1.0.0`, gets
  the notice `Phiên bản mẫu của bản nháp này không hỗ trợ xem trước hiệu ứng.` and the static
  rendering of its content. It never crashes.
- Enable the Studio `Xem trước` action. It awaits `flush()`, requests a preview link only when
  the draft is saved, then opens the link in the same tab. It shows clear messages for rate limits
  and failures. `Xuất bản` stays disabled.
- Let a valid preview token grant read-only access to one draft's content, and nothing else.
- Migrate the database to schema version `7`. The migration adds the `previewTokens` collection,
  its validator and TTL index, and adds `gift-preview` to the `apiRateLimits` scope enum.
- Add an E2E journey that uses local object storage: create a `memory-box` draft, upload a photo
  with a caption, preview it, see the photo and the caption inside the template, see the issues,
  and follow `Sửa` back to the focused Studio field.

This change belongs to **Sprint 3, Gate M2**. It is the fourth Sprint 3 change, archived in this
order: `add-memory-box-template`, `add-schema-driven-studio`, `add-local-object-storage`,
`add-gift-preview` (this change), `add-temporary-gift-publish`, `add-funnel-analytics`.

## Non-goals

- Publishing, share ids, the public Viewer route `/g/{shareId}` and its payload endpoint
  (`add-temporary-gift-publish`). This change only makes the transformer and the gift viewer
  reusable for them.
- Funnel analytics such as `preview_started` (`add-funnel-analytics`).
- Sharing a preview with other people. A preview link is private and short-lived. There is no
  "copy link" action, and nothing publishes preview URLs.
- Revoking preview links before they expire, or listing active links. Links only expire, and they
  stop working as soon as the gift is no longer a draft.
- Scene seeking or "jump to scene" in preview. Issues link to Studio fields, not to scenes.
- Pixel-diff visual baselines of preview. The E2E attaches screenshots only, as in
  `add-memory-box-template`.
- An artifact for `memory-box@1.0.0`. Its drafts get the static preview and the notice above.
- Changing the Viewer harness (`/viewer/...`) or `ViewerShell`.

## Capabilities

### New Capabilities

- `viewer-payload`: the single server-side transformer from a manifest, stored content, asset
  records and the audio catalog to the Viewer input. It covers:
  - artifact resolution;
  - asset URL selection and signing;
  - audio URL resolution;
  - field summaries;
  - content issues;
  - the rule that preview and the published Viewer both use it.
- `gift-viewer`: the reusable host that presents a gift to a person. It covers:
  - the envelope and the `Mở quà` gesture;
  - audio and mute;
  - `PLAY` only after `READY`;
  - pause and resume around page visibility;
  - template issue collection;
  - the static fallback on `ERROR`, initialization timeout or a missing artifact.
- `gift-preview`: preview links and the preview page. It covers:
  - token issuance, storage, lifetime and rate limit;
  - opaque not-found answers;
  - the `/preview/{token}` route and its headers;
  - the preview controls;
  - the issues panel with `Sửa` links;
  - the notice for a version without an artifact.

### Modified Capabilities

- `studio-editor`: "Studio preview and publish steps". The `Xem trước` action becomes available.
  It settles pending saves, requests a preview link and opens it. `Xuất bản` stays disabled.
- `template-viewer-runtime`:
  - "Initialization handshake": an iframe load restarts the attempt count, and each host defines
    what happens on timeout;
  - "Lifecycle control": status display is a harness feature, and the gift viewer is a production
    host;
  - "Pause when the page is hidden": the gift viewer's paused state and resume control;
  - "Audio only after a user gesture": the gesture is the harness `Phát` or the gift viewer's
    `Mở quà`, with a visible notice when audio cannot play.
- `gift-draft-ownership`: "Draft authorization". A valid preview token grants read-only access to
  one draft's content through two filtered queries. The preview payload also carries signed
  derivative URLs of that draft's `ready` assets. The token never grants update, claim, media or
  Studio access.
- `mutation-request-guards`: "Distributed mutation rate limits". Adds the `gift-preview` scope,
  30 requests per 600 seconds.
- `content-security-policy`:
  - "Route-based policy mode selection": `/preview/` uses the nonce policy;
  - "Nonce routes are dynamically rendered": the `/preview` route tree opts out of prerendering.
- `database-schema-management`: "Collection registry", "JSON-schema validators", "Named indexes",
  "Idempotent migration with ledger" and "Schema verification". These add the `previewTokens`
  collection, its validator and TTL index, the `gift-preview` scope and schema version `7`.

## Impact

- **Invariants touched**:
  - _Authorize inside the data-access filter; non-owners get an opaque 404_:
    - Token issuance authorizes through the existing `findAuthorized` filter.
    - Token lookup filters by the token hash and `expiresAt > now`.
    - The gift read filters by the gift id and `status: "draft"`.
    - Every failure (malformed token, unknown token, expired token, a gift that is not a draft, or
      no manifest) renders the same not-found page, and the issue route answers `404`
      `NOT_FOUND`.
  - _Return DTOs, never raw documents; storage keys and raw Blob URLs never reach the browser;
    signed URLs are short-lived_:
    - The transformer returns only asset ids mapped to signed URLs (default 300-second TTL).
    - It returns field summaries and issue codes, never storage keys, owner ids or asset
      documents.
    - `Phát lại` and the reduced-motion switch fetch fresh URLs instead of reusing expired ones.
  - _Template code runs in `sandbox="allow-scripts"`; the host accepts only schema-valid messages
    from that exact iframe_: the gift viewer uses the same bridge and trusted-event check as the
    harness. Template `ISSUE` field ids are shown only when they name a manifest field.
  - _Protected gift payloads never enter public caches; private routes use nonce CSP and
    `connection()`_:
    - `/preview/` is added to the nonce table, and its layout calls `connection()`.
    - Responses are `private, no-store`, `noindex` and `no-referrer`.
    - The token and the draft never enter a shared cache.
  - _Never log gift text, tokens or signed URLs_:
    - Tokens are stored only as hashes.
    - Route failures log only an event name and the request id.
    - The development request log ignores `/preview/`.
    - Issues carry field ids, never text.
  - _Audio starts only from a user gesture; reduced-motion and no-audio paths exist_:
    - Audio starts only inside the `Mở quà` or `Tiếp tục` handler.
    - Mute and a no-audio path always exist.
    - The preview has a reduced-motion switch, and the static fallback has no motion.
  - _Validate untrusted input at every entry_:
    - The route parameter and the token format are checked before any database access.
    - The `POST` body is strict `{}`.
    - Template events are schema-validated.
- **Code**:
  - new `apps/web/src/modules/viewer/`: the payload transformer (application), the gift viewer
    controller, the static content model and the components (presentation);
  - new `apps/web/src/modules/preview/`: the preview service, the Mongo token repository, the
    route handler, the preview screen and the issues panel;
  - `apps/web/src/composition/preview.ts` (new), `composition/media.ts` (exposes storage signing
    to the transformer), `modules/audio/application/audio-catalog.ts` (track lookup);
  - `modules/gifts`: a repository method to read a draft by id, the `gift-preview` rate-limit scope,
    and the Studio `Xem trước` action (`presentation/studio/`);
  - `app/api/gifts/[publicId]/preview/route.ts`, `app/preview/layout.tsx`,
    `app/preview/[token]/page.tsx`;
  - `security/content-security-policy.ts`, `next.config.ts` (the `/preview/:path*` headers and
    development log ignore, both additive);
  - `packages/contracts` (preview request and response schemas);
  - `packages/database` (`COLLECTIONS.previewTokens`, the migration and version `7`);
  - `apps/web/e2e/preview.spec.ts` (new).
- **Docs**: `docs/architecture.md` (a "Preview and gift viewer" section, including the rollback
  note for schema version `7`).
- **APIs**: new `POST /api/gifts/{publicId}/preview` and the page `/preview/{token}`. No existing
  route or DTO changes.
- **Data**:
  - the new collection `previewTokens` `{ _id: tokenHash, giftId, createdAt, expiresAt }` with a
    TTL index;
  - the `apiRateLimits` `scope` enum gains `gift-preview`;
  - `DATABASE_SCHEMA_VERSION` goes from `6` to `7`.

  The migration is additive, and no existing document changes.

- **Dependencies**: none added.
