# Sprint 3 review: findings and disposition

On 2026-10-01, three read-only reviews (senior BA, senior DEV, senior QA) covered the Sprint 3
change set `3b780e9..feat/sprint-3` at `8af352a`. This document records the disposition of every
finding.

- **Fixed:** the accepted findings, through the OpenSpec change `fix-sprint-3-review-findings`
  (archived with this work).
- **Waiting for the Product Owner:** the decisions in section 3.
- **Still manual:** the Gate M2 checks in section 4.
- **Next sprint:** the deferred engineering debt in section 5.

## 1. Summary of the three reviews

| Reviewer   | Findings                                      | Verdict                                                                                                                                                                                                                                                 |
| ---------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Senior BA  | 3 critical, 12 major, 15 minor, 8 suggestions | The engineering slice is solid and honestly documented. Gate M2 is not achieved: every human and real-device check is pending. Two product issues would likely break the staging demo: the catalog dead end (C2) and the cross-browser magic link (C3). |
| Senior DEV | 0 blockers, 4 major, 14 minor, 13 nits        | No security invariant is broken. Data retention, a client race and layering drift need fixes.                                                                                                                                                           |
| Senior QA  | 0 blockers, 0 critical, 1 major, 9 minor      | Merging to `dev` is acceptable once D-1 (no request timeout) has an owner. Gate M2 is not passed, and the evidence must be re-run at HEAD.                                                                                                              |

The three reviewers agree on four points:

- no security invariant is broken;
- the publish, idempotency and concurrency design is sound;
- Gate M2 stays open until the manual staging checks run;
- two catalog templates dead-end.

The full reports are working notes of the review session and are not committed. The IDs below
refer to them:

- `BA-C`, `BA-M`, `BA-m`, `BA-S`: BA critical, major, minor and suggestion findings;
- `DEV-M`, `DEV-m`, `DEV-NIT`: DEV major, minor and nit findings;
- `QA-D`, `QA-Q`, `QA-T`: QA defects, test-quality findings and traceability gaps.

## 2. Disposition of the engineering findings (Bucket A)

Legend:

- **ACCEPT:** fixed in this change.
- **PARTIAL:** the main finding is fixed, and the listed sub-items are deferred or rejected.
- **DEFER:** real, but moved to the Sprint 4 debt list (section 5) with a reason.
- **REJECT:** not a defect, or not worth fixing, with the evidence.

Commits on `feat/sprint-3`:

| Commit    | Content                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `5d45593` | Proposal                                                                     |
| `c7b3abd` | Studio, catalog, sign-in, timeouts and image field                           |
| `2a31742` | Server fixes                                                                 |
| `4af5d12` | Gift viewer                                                                  |
| `33980f8` | Real `404` status                                                            |
| `c30f945` | ESLint guard and verification script                                         |
| _(below)_ | This document and the results update, then the archive, are separate commits |

Task numbers refer to `openspec/changes/archive/*-fix-sprint-3-review-findings/tasks.md`.

| #   | Finding (sources)                                                                                                                          | Disposition | What was done, or why not                                                                                                                                                                                                                                                                                                                                                      | Ref                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| A1  | Templates without an artifact are creatable, then dead-end at publish (BA-C2, DEV-M2, BA-m2)                                               | ACCEPT      | Catalog summaries carry `available`, which is true only when an artifact is registered. Cards and the detail page show `Sắp ra mắt` with no `Dùng template này`. `/studio/new` and `POST /api/gifts` refuse with `404`. An existing draft on such a version gets an early notice, and `Xuất bản` is disabled with an explanation.                                              | `c7b3abd`, 1.1–1.4            |
| A2  | Anonymous draft stranded by a magic link opened in another browser; claiming is a second step (BA-C3)                                      | ACCEPT      | The Studio claims the draft automatically when its creator returns signed in, in the same browser. The Studio not-found page explains the cross-browser case, the sign-in confirmation asks the creator to open the link in the same browser and device, and the risk register has an entry. Email OTP is PO decision P9.                                                      | `c7b3abd`, 2.1–2.4            |
| A3  | Editor stays editable while publishing: lost edits or a false conflict (DEV-M3)                                                            | ACCEPT      | The store gains a `publishing` flag. Edits are ignored and every field is disabled while the publish request runs, and editing resumes on any outcome other than `201`.                                                                                                                                                                                                        | `c7b3abd`, 3.1–3.3            |
| A4  | No request timeout: a stalled save, preview, publish or upload hangs (QA-D-1)                                                              | ACCEPT      | `fetchWithTimeout` aborts a save, reload or preview after 15 s, a publish after 30 s (the retry reuses the same `Idempotency-Key`), and media grant and completion requests after 15 s. An XHR stall timer aborts an upload after 30 s without progress.                                                                                                                       | `c7b3abd`, 4.1, 5.3           |
| A5  | Raw theme ids, upload statuses, asset UUIDs and English jargon (BA-M4, BA-M5, BA-m5)                                                       | ACCEPT      | Themes are named `Đêm hồng` and `Giấy ấm`, and the empty choice reads `Mặc định (Đêm hồng)`. Statuses use Vietnamese labels, an image without a file name shows `Ảnh {n}`, `MiB` becomes `MB`, and `template` becomes `mẫu quà` in the image field. The copy glossary itself is P7.                                                                                            | `c7b3abd`, 5.1, 5.4           |
| A6  | Publishing is irreversible with no confirmation (BA-M7)                                                                                    | ACCEPT      | `Xuất bản` opens a confirmation (`Xuất bản món quà này?`, `Xác nhận xuất bản` / `Quay lại chỉnh sửa`) that states the gift cannot be edited or withdrawn yet. The rights checkbox is PO decision P4.                                                                                                                                                                           | `c7b3abd`, 3.3                |
| A7  | `giftRevisions` grows forever (DEV-M1)                                                                                                     | ACCEPT      | Each save keeps the 20 most recent snapshots, pruned in the same transaction and served by the identity index. No migration is needed. The retention is documented in `docs/architecture.md`.                                                                                                                                                                                  | `2a31742`, 6.1                |
| A8  | Rate limiter refuses concurrent first requests (DEV-m1); analytics charging differs from the spec (QA-D-4)                                 | ACCEPT      | On `E11000`, the limiter retries once without upsert. The `funnel-analytics` spec now states the implemented order: the network counter is charged only after the session counter allowed the request.                                                                                                                                                                         | `2a31742`, 6.2                |
| A9  | Publish, preview and public-gift `500`s log no error name (DEV-m2)                                                                         | ACCEPT      | Every route catch uses `reportOperationalFailure`, which records the operation, the error class and the request id, never the message.                                                                                                                                                                                                                                         | `2a31742`, 6.4                |
| A10 | A flush during a `429` window drops the save (DEV-m3)                                                                                      | ACCEPT      | The flush schedules the rate-limit retry and shows `Chưa lưu được — thử lại`.                                                                                                                                                                                                                                                                                                  | `c7b3abd`, 4.2                |
| A11 | `MediaImageListField` keeps working after unmount (DEV-m4)                                                                                 | ACCEPT      | An alive guard stops new requests and reports after unmount. Polling is keyed on a pending flag, refreshes are single-flight, and failed delete and retry requests show a message.                                                                                                                                                                                             | `c7b3abd`, 5.2                |
| A12 | Viewer edge states: audio after hide on the finale; broken image after a failed refresh (DEV-m5, QA-D-5)                                   | ACCEPT      | Audio paused by hiding the page after `COMPLETE` resumes when the page is visible again. An image whose refresh fails (deferred rejection, or no host answer within 10 s) shows its caption. The uncertain preview `pendingRestart` sub-item is rejected; see note 1.                                                                                                          | `4af5d12`, 7.1                |
| A13 | The public viewer reads assets by gift, not from the snapshot (DEV-m8)                                                                     | ACCEPT      | New `listByIdsForGift`. The public payload reads exactly `publication.assetIds`, filtered by the gift id.                                                                                                                                                                                                                                                                      | `2a31742`, 6.5                |
| A14 | A malformed captioned item throws a `500` (DEV-NIT4)                                                                                       | ACCEPT      | `listImageFieldReferences` skips items that are not objects or have no string `assetId`. Full-schema validation still blocks publish.                                                                                                                                                                                                                                          | `2a31742`, 6.6                |
| A15 | Spoofable `x-vercel-forwarded-for` off Vercel (DEV-NIT3); unthrottled page renders (DEV-NIT2); uncapped bodies (DEV-m14)                   | PARTIAL     | Accepted: the header is trusted only when `VERCEL=1`, and bodies are capped at 1 KiB (publish, preview) and 64 KiB (`PATCH`), answering `413`. Deferred: rate limits on page renders, because a page needs a designed `429` state and 128-bit share ids make enumeration pointless (D1).                                                                                       | `2a31742`, 6.3–6.4            |
| A16 | Viewer re-INIT on later loads (DEV-NIT1); wrong blank-load guard (QA-D-6); repeated scene notice (QA-D-8); lost focus (QA-D-7)             | PARTIAL     | Accepted: the iframe is created only with its URL, focus moves to `Đang mở quà…`, `Tiếp tục` and `Thử lại`, and a repeated scene notice is ignored. NIT1 is rejected; see note 2.                                                                                                                                                                                              | `4af5d12`, 7.1–7.3            |
| A17 | An interrupted upload leaves an action that cannot succeed (QA-D-3)                                                                        | ACCEPT      | A failed or stalled transfer deletes the new asset, removes the item and asks the creator to pick the image again. A reload still offers `Hoàn tất tải lên` for a recovered `initiated` item.                                                                                                                                                                                  | `c7b3abd`, 5.3                |
| A18 | Hygiene: validator, replay lookup, no-op updates, read-only editor, duplicates, fabricated `Request`, stale names (DEV-NIT5–8, 10, 11, 13) | PARTIAL     | Accepted: no-op updates notify nobody (NIT10), the read-only editor is disabled and stops the leave warning (NIT11), `getGiftRequestContextFromHeaders` (NIT13), the folded `requestId` and `429` helpers (part of NIT5), and the stale comment (part of NIT6). Deferred: the validator `anyOf` (NIT7, D4) and the replay lookup by revision (NIT8, D5). Rejected: see note 3. | `c7b3abd`, `c30f945`, 9.1–9.2 |
| A19 | Layering drift; the rate limiter lives in gifts; no lint guard (DEV-M4)                                                                    | PARTIAL     | Accepted: an ESLint rule bans infrastructure imports from presentation, with a two-file allowlist. Deferred: moving the limiter and composing route rate limits (D2). It is a cross-cutting refactor of about twelve route files with no behavior change, best done when the Sprint 4 payment scopes land.                                                                     | `c30f945`, 9.3                |
| A20 | Duplicated tabs share the analytics session and once-keys (QA-D-10)                                                                        | DEFER       | A reliable fix needs cross-tab coordination (BroadcastChannel claim), because browsers copy `sessionStorage` on "Duplicate tab". The impact is bounded: analytics is off in Production and analysis de-duplicates by `giftRef` (D3).                                                                                                                                           | —                             |
| A21 | Soft 404 (HTTP 200) on unknown `/g` and `/preview` (QA-D-2, DEV-NIT12)                                                                     | ACCEPT      | The home page and its loading UI moved into `app/(home)/`, so these routes answer a real `404`. A probe build confirmed it, and the E2E journeys assert it. The Studio keeps its skeleton, so its not-found page stays `200`, as documented.                                                                                                                                   | `33980f8`, 8.1                |
| A22 | Results evidence predates `bee9eb7`; counts are stale (QA-D-9, BA-m12)                                                                     | ACCEPT      | `docs/sprints/sprint-3-results.md` was re-run and updated at the final HEAD.                                                                                                                                                                                                                                                                                                   | 10.2                          |
| A23 | Cheap test debt (status assertions, runtime-error E2E, image-field error paths, real-Mongo CAS, flaky timing) (DEV-m10, DEV-m11)           | PARTIAL     | Accepted: not-found status assertions, ten image-field error-path and label tests, and `db:verify-gifts` now isolating the revision compare-and-set (DEV-m10). Deferred: the runtime-error fallback E2E and an injectable autosave timer seam for the Studio component tests (DEV-m11) (D7).                                                                                   | `33980f8`, `c30f945`, 9.4     |

Totals: 23 Bucket A items. Seventeen were fixed in full and five in part, with the listed
sub-items deferred or rejected. One (A20) is deferred. None is rejected as a whole.

Notes on the rejected sub-items:

1. **A12, preview `pendingRestart` (DEV-m5, marked "uncertain").** `Phát lại` calls
   `router.refresh()`. With an expired token, the server renders the opaque not-found page, so
   the page changes and is not "dead". With a valid token, the refresh delivers a new viewer. No
   reproduction exists. Revisit this only if the staging charter (C5) shows a dead button.
2. **A16, DEV-NIT1 (re-INIT after a second iframe load).** It adds no exposure:
   - a template that navigates its frame elsewhere already holds the payload;
   - it could exfiltrate the payload through that navigation URL itself;
   - templates are first-party, immutable and reviewed releases (ADR-0004).

   Treating every second load as an error would also break the specified "new handshake budget
   after each `load`".

3. **A18, rejected sub-items.**
   - **NIT6, renaming `findEditableManifest`.** The name states the repository rule ("published
     or retired"). A rename touches every port and test for no behavior gain.
   - **NIT6, `preview-token.ts` randomness.** Style only. The token is CSPRNG-backed and tested.
   - **NIT5, the hash duplicated in `artifact-checks.mjs`.** It is a build-time script in another
     package, and a test pins equality.
   - **NIT5, `release.json` duplicating the release bytes.** A byte-identity test guards it.
   - **NIT5, the `consume*RateLimit` wrappers and the artifact `resolve` duplication.** They fold
     away with the limiter move (D2).

Choices made in this change that need **PO confirmation**. They are small, string-only and
reversible; the PO confirms them in the copy glossary (P7):

- **Publish confirmation:** `Xuất bản món quà này?`, `Sau khi xuất bản, bạn chưa thể chỉnh sửa
hay thu hồi món quà. Ai có đường dẫn đều mở được món quà.`, `Xác nhận xuất bản` and `Quay lại
chỉnh sửa`.
- **Catalog and creation:** `Sắp ra mắt`, `Mẫu quà này đang được hoàn thiện, bạn chưa thể tạo quà
từ mẫu này.` and `Mẫu quà này sắp ra mắt.`
- **Studio version notice:** `Phiên bản mẫu của bản nháp này chưa hỗ trợ xuất bản. Bạn vẫn có thể
chỉnh sửa và xem trước, nhưng chưa thể gửi quà.`
- **Theme names:** `Đêm hồng` (`rose-night`), `Giấy ấm` (`warm-paper`) and `Mặc định (…)`.
- **Upload statuses:** `Đang tải lên`, `Đang xử lý`, `Lỗi xử lý`, `Đang xóa` and `Ảnh {n}`.
- **Upload failures:** `Kết nối tải ảnh bị gián đoạn. Hãy chọn lại ảnh này.` and `Chưa xóa được
ảnh — thử lại.`
- **Recovery page and sign-in:** `Không mở được bản nháp này` with its explanation, and the
  sign-in line `Hãy mở liên kết trên cùng trình duyệt và thiết bị này để tiếp tục bản nháp của
bạn.`
- **Two behaviors:**
  - a signed-in creator returning to a draft held by this browser has it claimed automatically;
  - music paused by hiding the page after the finale resumes when the page is visible again.

## 3. Product Owner decisions (Bucket B)

Engineering implemented none of these.

| #   | Decision (sources)                                                              | Reviewers' recommendation                                                                                                                                     | Needed by                                                                                                    |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| P1  | Sender identity in the gift (BA-M1)                                             | Optional `sender-name` in `memory-box@1.2.0`, shown in the opening, the letter signature and the finale                                                       | Before templates 2–3                                                                                         |
| P2  | Recipient controls: replay, pause, back (BA-M2)                                 | Host-level `Xem lại` and pause now, `Trước` in the next template version, or update the storyboard and UX baseline                                            | Gate M2 review                                                                                               |
| P3  | The recipient's first impression: a generic envelope inside site chrome (BA-M3) | Chrome-less full-bleed `/g` layout, a closed-box cover with `Chạm để mở`, and no content before the tap                                                       | Gate M2 review                                                                                               |
| P4  | Who may publish on staging; takedown; rights checkbox (BA-M9, DEV-m7, BA-D10)   | Vercel Deployment Protection or an email allowlist on `dev`/`stg`, a manual revoke procedure, and a one-line rights confirmation in the publish confirmation  | Before the staging demo                                                                                      |
| P5  | A withdrawn track in a published gift (BA-m13)                                  | Silent mute (current), notify the owner, or offer a replacement, as the license terms decide; show the title, not the id                                      | Before the first real tracks                                                                                 |
| P6  | Edit-after-publish model and public URL format (BA-M7, BA-M8, BA-D7)            | Revision snapshots behind a stable `/g/{shareId}`; lock the format now                                                                                        | Resolved 2026-10-08: revision snapshots behind a stable `/g/{shareId}` (`change-gift-publication-revisions`) |
| P7  | Copy glossary and tone (BA-m5, BA-M5)                                           | A PO-owned glossary (`mẫu quà`, `Gửi quà`/`Xuất bản`, `bản nháp`) and a copy review, including the strings listed in section 2                                | Before the pilot                                                                                             |
| P8  | Writing prompts and helper text (BA-M6)                                         | Optional `help`/`placeholder` in the field contract, filled in `memory-box@1.2.0`                                                                             | Sprint 4                                                                                                     |
| P9  | Mobile sign-in method (BA-C3, BA-D9)                                            | Email OTP code alongside the magic link (Sprint 4 P0); the auto-claim is in place                                                                             | Sprint 4 (P0)                                                                                                |
| P10 | Licensed tracks for the demo (BA-M10)                                           | Two or three tracks with provenance; rename the step or hide the field while the catalog is empty                                                             | Gate M2                                                                                                      |
| P11 | Analytics additions and Production switch-on (BA-M11, DEV-m6)                   | `draft_created`, `draft_claimed`, `share_link_copied` and `publish_failed{reason}`; a signed analytics context; Production stays off until the privacy notice | Sprint 4                                                                                                     |
| P12 | Find a gift again / dashboard (BA-M8)                                           | Email the Studio and share links after a claim or publish now; a "Quà của tôi" list early in Sprint 4                                                         | Sprint 4                                                                                                     |
| P13 | PO and design sign-off of the UX baseline and storyboard (BA-M12)               | A 60-minute review of the harness captures and Playwright attachments, recorded in the UX baseline as a Gate M2 row                                           | Before the Gate M2 review                                                                                    |

## 4. Gate M2 and the manual checklist (Bucket C)

Gate M2 stays **open**. Automated green is not acceptance; the Product Owner signs the gate
explicitly.

| Step                                                                                                                             | Owner (role)   | Status  |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------- |
| Merge `feat/sprint-3` to `dev`, then promote to `stg` (no ad-hoc deploys)                                                        | Tech Lead      | Pending |
| Run `db:migrate` on `stg` (schema version 9; this change adds no migration)                                                      | Tech Lead      | Pending |
| Set `INTERNAL_PUBLISH_ENABLED`, `ANALYTICS_ENABLED` and `ANALYTICS_GIFT_REF_SECRET` on `stg`                                     | Tech Lead      | Pending |
| Confirm Vercel Deployment Protection on `dev` and `stg` (P4)                                                                     | Tech Lead + PO | Pending |
| Add at least one licensed track (P10)                                                                                            | PO             | Pending |
| PO and design sign-off of the UX baseline (P13)                                                                                  | PO + Designer  | Pending |
| QA staging charter C1, C2, C3, C8 and C9 on all P0 devices, with 0 blocker and 0 critical; each High has an owner and a deadline | QA             | Pending |
| Fill in `docs/quality/mobile-audio-checklist.md` and the results document's known issues                                         | QA             | Pending |
| Real-device performance (C12) compared with the lab baseline                                                                     | Tech Lead      | Pending |
| Record the dated results, then the PO signs the gate                                                                             | PO             | Pending |

### QA staging charter (summary of review-qa §7)

Setup:

- a staging build with publishing and analytics on and at least one licensed track;
- non-sensitive test content (Vietnamese with diacritics and emoji);
- for each session, record the device, OS and browser versions, the network and the last 4
  characters of the share link only.

P0 devices:

- iPhone (oldest supported, iOS 16–17) and a current iPhone, Safari;
- a mid-range Android (Galaxy A15/A25), Chrome;
- the Zalo in-app browser on both platforms;
- a Windows laptop, Chrome and Edge.

P1 devices are Messenger/Facebook in-app, a low-end Android and Firefox. P2 devices are Mac
Safari and a 280–320 px screen.

| ID  | Charter                                                                                                                                                                                                         | Gate M2 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| C1  | A non-technical creator builds a real gift with 3–8 of their own photos (HEIC, PNG, portrait), signs in through the email link, previews and publishes, with no coaching                                        | Yes     |
| C2  | An anonymous recipient on another device and in Zalo plays the gift to the end; preview equals published, including images                                                                                      | Yes     |
| C3  | A creator on a flaky network: airplane mode, Wi-Fi/4G handover, a stalled 3G save, closing the tab within 1 s, offline mid-upload. Check that the timeouts (A4) and the interrupted-upload cleanup (A17) behave | Yes     |
| C4  | Two tabs or two devices: both conflict choices, publishing in one tab, a duplicated tab                                                                                                                         | —       |
| C5  | Navigation: Back/Forward, preview → Back → `Xem trước`, `Sửa` links, old and expired preview links                                                                                                              | —       |
| C6  | Upload variety and failures: HEIC, Live Photo, WebP, 48 MP, 15 MB, GIF, renamed files, 9 files, cancel, captions at 140 characters                                                                              | —       |
| C7  | Publish robustness: double tap, killing the tab mid-publish, a photo still processing, signing out in another tab; check the confirmation step (A6)                                                             | —       |
| C8  | Recipient experience: slow 3G tap-before-ready, background and lock, landscape, OS reduced motion, 200 % text, VoiceOver and TalkBack (focus, A16), audio from the tap, mute, the silent switch                 | Yes     |
| C9  | In-app browsers and sharing: unfurl cards (generic, no event stored), in-app open, claim handoff from the mail app (A2 recovery page)                                                                           | Yes     |
| C10 | Template failure fallback: a blocked or slow artifact, one blocked photo                                                                                                                                        | —       |
| C11 | Edge content: ZWJ emoji at the limit, markup strings, `29/02/2024` in a US timezone, a 1200-character letter                                                                                                    | —       |
| C12 | Real performance: cold-cache opens on a low-end and a mid-range Android and an iPhone over a real mobile network, 3 runs each, with Web Vitals                                                                  | —       |

Exit for the manual part:

- C1, C2, C8 and C9 pass on all P0 devices;
- every issue is logged with a plan §19.4 severity, with 0 blocker and 0 critical;
- each High has an owner and a deadline.

## 5. Sprint 4 engineering debt (Bucket D and the deferrals)

| #   | Item                                                                                                                                                                                                                             | Source                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| D1  | Rate-limit the `/g` and `/preview` page renders (a designed `429` page, or Vercel Firewall rules)                                                                                                                                | A15, DEV-NIT2                |
| D2  | Move the generic rate limiter out of `gifts/infrastructure` into a port and adapter wired in composition; empty the ESLint allowlist                                                                                             | A19, DEV-M4                  |
| D3  | A per-tab analytics session that survives "Duplicate tab", and once-keys set only after a successful send                                                                                                                        | A20, QA-D-10                 |
| D4  | One schema-version bump: the `gifts` validator `anyOf` for published gifts, a migration downgrade guard (`--allow-downgrade`), and index rebuild under a temporary name                                                          | DEV-NIT7, DEV-m9             |
| D5  | Publish replay lookup by `{ giftId, revision }`, and an idempotency key namespace per actor, with the re-publish design. Replay by revision is done (`change-gift-publication-revisions`); the per-actor namespace is still open | DEV-NIT8                     |
| D6  | Asset authorization loaded by id and gift (`findByIdForGift`)                                                                                                                                                                    | DEV-m13                      |
| D7  | Runtime-error fallback E2E (an artifact that throws after `READY`), and an injectable autosave timer seam replacing the real-debounce Studio tests                                                                               | A23, QA-T21, DEV-m11         |
| D8  | A `webkit` Playwright project for `publish.spec.ts` and `memory-box.spec.ts`                                                                                                                                                     | QA-Q12                       |
| D9  | Screenshot baselines (`toHaveScreenshot`, per-OS) for the harness scenes, and preview-versus-published image comparison                                                                                                          | QA-Q1, QA-Q9b, BA-m10        |
| D10 | `failOnFlakyTests`, `trace: retain-on-failure`, and an e2e job timeout of about 35 minutes                                                                                                                                       | QA-Q2, QA-Q3                 |
| D11 | A per-context `x-vercel-forwarded-for` for all API routes in E2E, one shared cleanup helper (analytics events, job outbox, object directory), and collision-free test emails                                                     | QA-Q4, QA-Q5, QA-Q13, QA-Q14 |
| D12 | A real-MongoDB Vitest integration project (publish, concurrent saves, delete versus publish, unique share id, atomic rate limits)                                                                                                | QA-Q6, QA-T15                |
| D13 | HEIC, WebP, PNG, EXIF-rotated and corrupt-file fixtures in E2E, and a client-side MIME and size rejection test                                                                                                                   | QA §3                        |
| D14 | A Playwright run with a non-Vietnam `timezoneId`, and `emulateMedia({ reducedMotion })` on `/g`                                                                                                                                  | QA-T22, QA §3                |
| D15 | Coverage policy for logic-heavy `.tsx` (Studio, viewer, image field), and type-aware lint for `templates/*/src`                                                                                                                  | DEV-m12                      |
| D16 | `@perf` in CI on a schedule or on `stg` pushes, with soft thresholds, and one E2E smoke against Vercel Blob on `stg`                                                                                                             | DEV-m12, QA-Q11              |
| D17 | Template artifact route: precompute the ETag, and include the CSP inputs in the cache version                                                                                                                                    | DEV-NIT9                     |
| D18 | Fold the duplicated `consume*RateLimit` and artifact-resolve wrappers (with D2)                                                                                                                                                  | DEV-NIT5                     |
