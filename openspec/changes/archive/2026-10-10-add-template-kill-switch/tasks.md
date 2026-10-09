# Tasks

## 1. Pre-apply checks

- [x] 1.1 Confirm the starting point, and re-diff each MODIFIED block against `openspec/specs/`:
  - this is the only active change;
  - `DATABASE_SCHEMA_VERSION` is `13`;
  - the seed sets `status` with `$set`.

  Verify `pnpm openspec validate add-template-kill-switch --strict` and `pnpm spec:check` pass.

## 2. Version state and transitions

- [x] 2.1 Add `modules/templates/application/template-version-controls.ts`:
  - the port;
  - the action schema with the `reason` rule;
  - the service with `retire`, `kill`, `restore` and `listVersions`, its results and errors.

  Add `modules/templates/infrastructure/mongo-template-version-state.ts` (design Decisions 2–3),
  with each transition and its audit record in one transaction.

  Verify unit tests cover:
  - every transition's filter and update;
  - the no-op, `NOT_FOUND` and `VERSION_NOT_RELEASED` outcomes;
  - an audit record only on a change, with the reason metadata only for `kill`;
  - the kill lookup.

- [x] 2.2 Add the three actions to `AuditActionSchema`. Verify the audit tests.
- [x] 2.3 Change `upsertTemplateVersion` so the seed never changes the status of a version with
      `adminRetiredAt`. Verify seed tests for "Re-seeding keeps an admin retire", and that a fresh
      insert and a seed-driven retire still work.

## 3. Kill enforcement

- [x] 3.1 Add `resolveTemplateArtifact` to `composition/templates.ts`. Make
      `BuildViewerPayloadDependencies.resolveArtifact` and `publishing.artifacts.resolve` asynchronous,
      and wire both through it. Verify:
  - the viewer-payload test "Killed version";
  - the gift-service tests for a killed version: publish refused with `TEMPLATE_UNPUBLISHABLE`,
    creation refused with `NOT_FOUND`;
  - every existing test still passes.
- [x] 3.2 Make the artifact route answer `404` for a killed version, and the Studio page's
      `publishable` use `resolveTemplateArtifact`. Verify a route test for a killed version and a
      restore.

## 4. Admin route and page

- [x] 4.1 Add `POST /api/admin/template-versions` with its handler in
      `modules/templates/presentation/` (design Decision 4). Verify route tests:
  - each action;
  - kill without a reason answers `400`, and a reason on retire is refused;
  - `404`, `409 VERSION_NOT_RELEASED` and the no-op;
  - a non-admin gets `404`, and an admin without a step-up gets `403 MFA_REQUIRED`;
  - a foreign origin is refused.
- [x] 4.2 Add `/admin/templates` with the versions table and the row actions, and the `Mẫu quà`
      link. Verify component tests for:
  - the row states (current, artifact, killed with reason);
  - which actions are offered;
  - the confirmation and the request sent;
  - the error message.

## 5. Documentation

- [x] 5.1 Update:
  - `docs/runbooks/admin-access.md`: a "Template versions" section on when to retire, kill or
    restore, and the effects;
  - `docs/architecture.md`: the kill switch in "Admin access and audit";
  - ADR-0004: a note that a kill drops the artifact while the pinned version stays;
  - `docs/risk-register.md`: a row for a broken template version.

## 6. End-to-end

- [x] 6.1 Extract the admin sign-in, grant and enrollment of `admin.spec.ts` into
      `e2e/support/admin.ts`. Add `e2e/admin-templates.spec.ts`:
  - a stepped-up admin kills a test-only version inserted into the E2E database (so parallel tests
    are unaffected), sees `Đã tắt`, restores it, and finds both actions on the audit page;
  - a creator gets `404` on `/admin/templates`.

  Verify `pnpm test:e2e` passes for both admin specs.

## 7. Verification and archive

- [x] 7.1 Run `pnpm verify:local` and verify that it passes. Record any part that cannot run locally.

  **Run 2026-10-10:** passed in full:
  - the secret scan, `spec:check`, format, lint and types;
  - coverage: 1783 tests, 96.6% statements;
  - `pnpm audit` and the build;
  - `test:e2e:chrome`: 38 of 38.

  The kill effect on a real published gift is covered by unit and route tests, not E2E. Killing
  `memory-box@1.1.0` in the shared E2E database would break the parallel journeys.

- [x] 7.2 Archive with `pnpm openspec archive add-template-kill-switch --yes`, after diffing each
      MODIFIED block. Check the Purpose of `template-version-controls`. Verify `pnpm spec:check` passes.

## Out of scope

- Publishing or releasing template versions from the admin area.
- Migrating gifts to another version.
- Counts of gifts per version on the admin page.
- Owner email about a killed template (Sprint 5 `add-system-emails`).
