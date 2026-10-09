# Tasks

## 1. Pre-apply checks

- [x] 1.1 Confirm this is the only active change and that `PublishGiftRequestSchema` holds
      `expectedRevision` and `planId` only. Re-diff each MODIFIED block against `openspec/specs/`.
      Verify that `validate --strict` and `pnpm spec:check` pass with the one waiver.

## 2. Privacy notice and links

- [x] 2.1 Add `/privacy` with the retention table, `SiteFooter` in the root layout, and the
      sign-in notice line. Verify:
  - component tests for the footer link and the sign-in line;
  - a page test for the retention rows;
  - the CSP test that `/privacy` uses the static policy.

## 3. Rights confirmation and retention line

- [x] 3.1 Add `rightsConfirmed` to `PublishGiftRequestSchema` and `rightsConfirmedAt` to the
      publication (domain, repository mapping, publish). Verify:
  - contract tests: missing or `false` is refused;
  - the publish route test for "Rights not confirmed";
  - a publish service test that the record holds `rightsConfirmedAt`.
- [x] 3.2 Add the checkbox and the retention line to `publish-step.tsx`, and send
      `rightsConfirmed: true` from `publish-action.ts`. Verify component tests:
  - the disabled confirm button until checked;
  - the reset on reopen;
  - the retention line for `free`;
  - the request body.

## 4. Superseded publications

- [x] 4.1 Add `deleteSuperseded` to the cleanup job's publication port and its Mongo adapter, and
      call it after the current publication is read. Verify tests for the filter, the call order, and
      that nothing is deleted when the current publication is unreadable.

## 5. Owner export

- [x] 5.1 Add the export service, `GET /api/gifts/{publicId}/export`, and the Studio aside link.
      Verify tests for:
  - the exact DTO keys and the signed URLs;
  - draft accessors versus the owner of a published gift;
  - `404` for others and for deleting gifts;
  - the headers;
  - the rate limit.

## 6. Documentation

- [x] 6.1 Update:
  - `docs/architecture.md`: "Privacy notice, consent and export", and correct the
    superseded-publications statements;
  - the risk register: close "Superseded publications keep old gift text", and note P11 progress;
  - ADR-0010: the notice now exists, and analytics consent is still required before enabling it in
    Production.

## 7. End-to-end

- [x] 7.1 Update the publishing journeys for the checkbox and the field. Add
      `e2e/privacy.spec.ts`:
  - `/privacy` and the footer link;
  - the confirm button disabled until the checkbox is checked;
  - after an update, one publication record remains;
  - the owner's export downloads JSON with the content and no storage key.

  Verify that `pnpm test:e2e` passes.

## 8. Verification and archive

- [x] 8.1 Run `pnpm verify:local` and verify that it passes. Record any part that cannot run locally.

  **Run 2026-10-10:** passed in full:
  - the secret scan, `spec:check` (with the one waiver), format, lint and types;
  - coverage: 1892 tests, 96.6% statements;
  - `pnpm audit` and the build;
  - `test:e2e:chrome`: 44 of 44, the updated publish journeys and `privacy.spec.ts` included.

- [x] 8.2 Archive with `pnpm openspec archive add-privacy-consent-and-export --yes`, after diffing
      each MODIFIED block. Then:
  - remove the waiver;
  - check the Purpose of `privacy-notice`.

  Verify `pnpm spec:check` passes.

## Out of scope

- Automatic deletion of expired gifts and abandoned drafts (needs PO retention periods).
- An analytics consent banner; account deletion and account export; terms of service.
