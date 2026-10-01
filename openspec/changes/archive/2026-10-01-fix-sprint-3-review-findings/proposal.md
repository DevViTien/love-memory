# Proposal

## Why

Three Sprint 3 reviews (senior BA, DEV and QA) of `feat/sprint-3` found no broken security
invariant. They did find defects that would derail the Gate M2 staging demo or lose creator work:

- Two catalog templates can be chosen and fully edited, then cannot be published.
- An anonymous draft is stranded when the magic link opens in another browser, and claiming is a
  separate second step.
- Edits typed while `Xuất bản` runs are lost, or show a false conflict.
- A stalled request leaves the Studio on `Đang lưu…` or `Đang xuất bản…` forever.
- Publishing is irreversible but happens on one tap.
- `giftRevisions` keeps a full copy of private text for every autosave, forever.
- Several smaller races and edge states, listed below.

This change fixes the accepted Bucket A findings on the Sprint 3 branch, before it merges to `dev`
and before Gate M2 (plan.md §12). The disposition of every finding, including deferrals and
rejections, is recorded in `docs/sprints/sprint-3-review.md`.

## What Changes

- **Catalog availability.** A template version without a registered artifact is shown as
  `Sắp ra mắt` and offers no `Dùng template này`. Draft creation for it is refused with `404`.
  An existing draft on such a version shows an early notice in the Studio, and its `Xuất bản`
  stays disabled with that explanation.
- **Sign-in handoff.** Opening the Studio signed in, while the browser still holds the draft's
  anonymous cookie, claims the draft automatically (idempotent, owner filter unchanged). The
  Studio not-found page explains that an anonymous draft opens only in the browser that created
  it. The sign-in confirmation asks the creator to open the link in the same browser and device.
- **Publish safety.**
  - `Xuất bản` first asks for confirmation (`Xác nhận xuất bản`) and states that the gift cannot be
    edited or withdrawn yet.
  - While the publish request runs, every field is read-only and edits are ignored.
  - After the draft became non-editable, fields stay read-only and the leave warning stops.
- **Request timeouts.**
  - A save, draft reload or preview request with no answer after 15 s is aborted and handled as a
    network failure.
  - A publish request is aborted after 30 s, and a retry reuses the same `Idempotency-Key`.
  - Image upload grant and completion requests time out after 15 s.
  - An upload transfer with no progress for 30 s is aborted.
- **Image field.**
  - An interrupted transfer deletes the new asset and asks the creator to pick the image again,
    instead of leaving an action that cannot succeed.
  - Statuses are shown as Vietnamese labels, never raw enum values or asset IDs.
  - After unmount the field neither writes nor reports.
  - A failed delete or retry shows a message.
- **Theme labels.** Theme options show Vietnamese labels (`Đêm hồng`, `Giấy ấm`; unknown ids
  verbatim), and the empty option names the default theme.
- **Revision retention.** Each save keeps at most the 20 most recent revision snapshots of the
  gift, pruned in the same transaction.
- **Rate limits.**
  - Two concurrent first requests in a new window both count instead of one being refused.
  - `x-vercel-forwarded-for` is trusted only when the server runs on Vercel.
  - Analytics charging is specified as implemented: the network counter is charged only when the
    session counter allowed the request.
- **Request bodies.** Publish and preview bodies are capped at 1 KiB and draft saves at 64 KiB
  (`413`). Every unexpected route failure logs the operation, the error name and the request id.
- **Gift viewer.**
  - The iframe is created with its artifact URL, so no blank-document load is ever observed.
  - Focus moves to `Đang mở quà…`, `Tiếp tục` or `Thử lại` instead of being lost.
  - Music paused by hiding the page after `COMPLETE` resumes when the page is visible again.
  - An expired image whose URL refresh fails shows its caption.
  - A repeated scene notice no longer completes a scene early.
- **Real not-found status.** Unknown `/g/{shareId}` and `/preview/{token}` links answer HTTP `404`
  instead of a streamed `200`.
- **Public payload.** It reads exactly the publication snapshot's `assetIds`.
- **Defensive fixes.**
  - A malformed captioned item no longer throws a `500`.
  - No-op Studio edits no longer notify subscribers.
- **Engineering hygiene.** An ESLint guard stops new presentation→infrastructure imports. The
  duplicated request-id and `429` helpers are folded. Pages read the request context from headers,
  not from a fabricated `Request`.
- **Tests.**
  - Not-found status assertions in E2E.
  - Image-field error-path component tests.
  - A real-MongoDB check that isolates the publish revision compare-and-set.

## Non-goals

Deferred engineering work (Sprint 4 debt list in `docs/sprints/sprint-3-review.md`):

- Moving the rate limiter out of the gifts module and wiring route rate limits through
  composition (A19). This change adds only the ESLint guard with an explicit allowlist.
- Rate limits on the `/g` and `/preview` page renders. The API is limited, and share ids are
  128-bit.
- A per-tab analytics session that survives "Duplicate tab" (A20); it needs cross-tab
  coordination.
- The `gifts` validator rule "published requires `shareId`/`publishedAt`", the migration downgrade
  guard and the index-rebuild window (one schema-version bump in Sprint 4).
- A publish replay lookup by `{ giftId, revision }`, together with the re-publish design.
- A runtime-error fallback E2E, a `webkit` project, screenshot baselines, a real-MongoDB Vitest
  suite, HEIC/WebP fixtures, CI flake policy and the other Bucket D items.

Product Owner decisions, not implemented here (Bucket B):

- sender identity;
- recipient replay and pause controls;
- the recipient envelope design;
- who may publish on staging and the rights checkbox;
- withdrawn tracks;
- edit-after-publish and the public URL format;
- the copy glossary;
- writing prompts;
- email OTP sign-in;
- licensed demo tracks;
- analytics additions;
- a gift dashboard;
- the UX sign-off.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `template-catalog`: summaries carry availability; unavailable templates are `Sắp ra mắt` without a
  create action.
- `gift-drafts`: creation requires a registered artifact; bounded revision history;
  `/studio/new` for an unavailable template.
- `gift-draft-ownership`: automatic claim when the Studio opens; Studio not-found guidance.
- `creator-authentication`: same-browser guidance in the sign-in confirmation.
- `studio-editor`: theme labels, publish confirmation, read-only editor states, notice for
  unpublishable template versions, publish and preview request timeouts.
- `studio-autosave`: save timeout; no leave warning once the draft is non-editable.
- `studio-image-list-field`: request timeouts and stall detection, interrupted-transfer cleanup,
  Vietnamese status labels, safe failure messages.
- `mutation-request-guards`: concurrent first requests, Vercel-only trust of the forwarding header,
  body size caps, failure logging with the error name.
- `funnel-analytics`: analytics counters charged in order.
- `gift-viewer`: iframe created with its artifact URL, focus management, audio after `COMPLETE`.
- `public-gift-viewer`: unknown share links answer `404`.
- `gift-preview`: unknown preview links answer `404`.

## Invariants touched

- **Opaque 404 for non-owners.** Kept, and strengthened by the real `404` status. The Studio
  recovery page is the same page for every not-found cause.
- **Authorize inside the data-access filter.** The automatic claim reuses the claim repository
  write, filtered on the anonymous credentials, `ownerId: null` and status `draft`. The public
  payload now filters assets by the snapshot ids and the gift id.
- **Signed URLs only after authorization.** Unchanged; snapshot assets are signed after the
  liveness check.
- **Never log gift text, tokens or signed URLs.** Logs gain only an error name (a class name) and
  an operation name.
- **Publish is idempotent.** A timed-out publish is retried with the same `Idempotency-Key` and
  is answered as a replay.
- **Template sandbox and exact-iframe messages.** Unchanged. Creating the iframe with its URL
  removes a guard that compared the wrong value.
- **Audio only from a gesture.** Audio resumes after `COMPLETE` only if that gesture already
  started it on this page.
- **Nonce CSP on private routes.** Unchanged. The home page moves into a route group, so `/g` and
  `/preview` no longer inherit the root loading boundary.

## Impact

- **Web app.**
  - `modules/templates/**`, `app/(home)/**` (moved from `app/page.tsx`, `app/loading.tsx`),
    `app/templates/[templateId]/page.tsx`, `app/studio/**`, `composition/{templates,gifts}.ts`.
  - `modules/gifts/{application,infrastructure,presentation}/**`, including the Studio components
    and controllers.
  - `modules/media/presentation/media-image-list-field.tsx`,
    `modules/viewer/presentation/gift-viewer{,-controller}.ts(x)`,
    `modules/analytics/presentation/recipient-events.ts`,
    `modules/public-gifts/application/public-gift-service.ts` and the media repository.
  - `modules/auth/presentation/magic-link-form.tsx`, the API route handlers, and
    `eslint.config.mjs`.
- **Packages.** `packages/template-sdk/src/payload.ts`.
- **Scripts.** `scripts/verify-gift-persistence.ts`.
- **E2E.** The specs that publish (confirmation step), plus status assertions.
- **Docs.** `docs/sprints/sprint-3-review.md` (new), `docs/sprints/sprint-3-results.md`,
  `docs/risk-register.md`, `docs/architecture.md`.
- No migration, no schema version change and no new environment variable. `VERCEL` is read only to
  decide whether the forwarding header is trusted.
