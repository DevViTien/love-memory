# Design

## Context

The findings come from writing the Sprint 0–2 baseline specs from code. Each fix is small and local;
none needs a migration. The governing decisions are ADR-0003 (private media, source deletion),
ADR-0005 (route CSP modes), ADR-0007 (passwordless identity, admin requires MFA) and the
technical-spike runbooks.

## Decisions

### Magic-link errors are mapped, never echoed

Better Auth builds the error redirect by setting `error` on `errorCallbackURL`, which overwrites any
value already in the URL. The form therefore sends a plain `/auth/sign-in` error callback, and a
small pure mapper in `modules/auth/presentation` turns any error value into one of two fixed
Vietnamese messages. Provider `error_description` text is never rendered, so no provider detail or
token-shaped value reaches the page.

### Spike Production guard uses `VERCEL_ENV`

`NODE_ENV` is `production` for every `next start`, including local and CI E2E runs that
legitimately exercise the spikes, so it cannot identify Production. Vercel sets `VERCEL_ENV` to
`production` only for Production deployments. The guard lives in `parseTechnicalSpikeEnvironment`,
so the proxy, pages and API handlers all inherit it. It forces `enabled: false` rather than throwing,
because the proxy reads this configuration on every request and a throw would take the whole site
down.

### Shared `unidentified` bucket instead of no limit

Production runs on Vercel, where `x-vercel-forwarded-for` is always present, so the fallback only
matters for self-hosted or local runs. There is no trustworthy per-client key in that case, so all
such requests share one bucket per scope at five times the per-subject limit. That bounds abuse
without breaking local E2E runs, which create a few anonymous drafts per project.

### Terminal media failures release the source object

A `PROCESSING_FAILED` source is kept while a retry can still use it. Once no retry is possible, the
worker deletes it: on the third failed attempt, and when claiming turns an exhausted stale lease or
an unclaimable asset into `failed`. For the claim paths, the repository returns
`{ exhaustedAsset }` alongside the existing `{ asset, jobId }` claim shape, so storage access stays
in the worker (application layer) and the repository stays storage-free. The failed asset record
stays, so the Studio can still show it and the creator can delete it and free the quota slot.

### Admin bypass removed until admin work exists

The gift repository no longer honours `isAdmin`; the flag is removed from `GiftAccessor`, and the
unused `canManageOwner` helper goes with it. Sprint 6 reintroduces admin access behind MFA and audit,
through a dedicated admin use case rather than a filter-wide bypass.

### Smaller consistency fixes

- `app/viewer/layout.tsx` calls `connection()`, matching the Studio layout and ADR-0005.
- `next.config.ts` adds a `SAMEORIGIN` rule for `/template-artifacts/:path*`, the same pattern
  already used for `/template-spikes`.
- The crop uses `blob.type` when it is `image/png` or `image/jpeg` and falls back to WebP labelling
  otherwise; the upload allowlist already accepts all three.
- Readiness uses the existing `API_ERROR_CODES.unavailable`.

## Risks

- Any operator workflow that relied on `admin` reading drafts stops working. There is no admin UI
  today, so the risk is limited to ad-hoc database-promoted users.
- The shared bucket can throttle all unidentifiable clients together on a self-hosted deployment.
  This is acceptable because Production is Vercel-only.
