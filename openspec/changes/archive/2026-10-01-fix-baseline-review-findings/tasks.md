# Tasks

## 1. Authentication

- [x] 1.1 Add a sign-in error mapper with unit tests; render its message on `/auth/sign-in`
- [x] 1.2 Send a plain `/auth/sign-in` error callback from the magic-link form
- [x] 1.3 Add an E2E test that follows a real invalid magic-link verification to the alert

## 2. Technical spikes

- [x] 2.1 Force spikes off when `VERCEL_ENV` is `production`, with unit tests

## 3. Rate limiting

- [x] 3.1 Fall back to the shared `unidentified` subject at five times the scope limit, with tests

## 4. Media processing

- [x] 4.1 Delete the source object on the third `PROCESSING_FAILED` attempt, with a worker test
- [x] 4.2 Return `{ exhaustedAsset }` from claiming when an asset is failed terminally and delete its
      source in the worker, with repository and worker tests

## 5. Draft authorization

- [x] 5.1 Remove `isAdmin` from `GiftAccessor`, the repository filter, the route helper, the
      persistence verifier and the unused `canManageOwner` helper; update tests

## 6. Consistency fixes

- [x] 6.1 Add `app/viewer/layout.tsx` calling `connection()`
- [x] 6.2 Send `X-Frame-Options: SAMEORIGIN` for `/template-artifacts/:path*`
- [x] 6.3 Label the cropped file with the encoded format, with a unit test
- [x] 6.4 Use `SERVICE_UNAVAILABLE` for readiness failures

## 7. Documentation

- [x] 7.1 Align `docs/architecture.md`, ADR-0003, ADR-0007, `docs/runbooks/media-pipeline.md` and
      `templates/README.md` with the shipped behavior

## 8. Verification and archive

- [x] 8.1 Run `pnpm spec:check`, `pnpm format:check`, `pnpm lint`, `pnpm type-check` and
      `pnpm test:coverage`
- [x] 8.2 Run the production-build E2E suite, or record why it cannot run locally
- [x] 8.3 Archive this change in the same PR

## Out of scope

- Admin tooling with MFA and audit (Sprint 6).
- Retention of abandoned drafts and their ready assets (Sprint 6).
- Real payload, audio and asset wiring in the Viewer (Sprint 3).
