<!-- Title: conventional commit, e.g. feat(studio): generate fields from the template manifest -->

## Summary

<!-- What changes for users or API clients, and why (1–3 sentences). -->

## OpenSpec

- [ ] Behavior changed → change: `openspec/changes/<name>/`, archived in this PR
- [ ] No behavior change (fix/refactor/tooling) → no change needed
- [ ] `pnpm spec:check` passes

## Verification

<!-- Commands run and results. Attach screenshots for visual changes. -->

- [ ] `pnpm verify:local` (or list the parts that could not run locally and why)

## Invariants

- [ ] Authorization inside the data-access filter; non-owners get an opaque 404
- [ ] DTOs only; no storage keys, raw Blob URLs or raw documents reach the browser
- [ ] Long-running/retryable work goes through the outbox, not the request
- [ ] Template artifacts stay immutable and sandboxed; CSP mode matches the route
- [ ] No gift text, tokens, passwords or signed URLs in logs; no secrets committed

## Risk and rollout

<!-- Migrations (`pnpm db:migrate`), environment variables, jobs to redeploy, rollback notes. -->
