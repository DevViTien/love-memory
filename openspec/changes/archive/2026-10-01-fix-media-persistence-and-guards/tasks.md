# Tasks

## 1. Media persistence

- [x] 1.1 Replace `distinct` and the parallel reads in `createWithinQuota` with one projected `find`,
      reset `created` at the start of the transaction callback, and update repository tests
- [x] 1.2 Reset `claimed` at the start of the `claimNext` transaction callback
- [x] 1.3 Add `scripts/verify-media-persistence.ts` and the `db:verify-media` command

## 2. Rate limiting

- [x] 2.1 Charge anonymous requests to a `network:` guard at five times the scope limit, with tests

## 3. Processing

- [x] 3.1 Bound the placeholder to 24 px on its longest side and drop oversized placeholders in the
      worker, with tests
- [x] 3.2 De-duplicate drain dispatch per asset and pass the asset ID from the routes, with tests

## 4. Studio

- [x] 4.1 Report the recovered order against the saved order, with a component test
- [x] 4.2 Allow one selection loop at a time and revoke replaced crop object URLs
- [x] 4.3 Re-encode non-WebP crops as JPEG and release the canvas, with tests

## 5. CI

- [x] 5.1 Run `pnpm db:verify-media` in the E2E job after `pnpm db:verify-gifts`

## 6. Verification and archive

- [x] 6.1 Run `pnpm spec:check`, `pnpm format:check`, `pnpm lint`, `pnpm type-check` and
      `pnpm test:coverage`
- [x] 6.2 Run `db:verify-gifts`, `db:verify-media` and the production E2E suite against a local
      MongoDB replica set with Stable API strict mode
- [x] 6.3 Archive this change in the same PR

## Out of scope

- Self-authenticating anonymous cookies.
- Per-attempt derivative keys, per-identity byte quotas and delayed dispatch for automatic retries.
- Crop dialog focus trap and Escape handling.
