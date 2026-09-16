# Preview deployment and rollback runbook

## Purpose

Deploy the Turborepo from GitHub to Vercel, prove health/security/spikes with non-production data and
restore a known-good deployment without destructive database rollback.

## One-time Vercel setup

1. Import the GitHub repository as a new Vercel Project.
2. Keep Root Directory at the repository root (`./`) and Framework Preset at Next.js.
3. Let Vercel detect pnpm from the root lockfile and Turborepo from `turbo.json`.
4. Add Preview-scoped `MONGODB_URI`, `MONGODB_DATABASE` and `APP_URL`. Use a dedicated non-production
   database; never reuse production data in a pull-request deployment.
5. Leave technical spikes disabled until their separate token and provider configuration are ready.
6. Protect Preview URLs if they contain test data.

Every pull request then receives a unique Preview Deployment through the Vercel Git integration.
The production branch remains `main` unless explicitly changed in Project Settings.

## Optional protected spike setup

Add only to Local/Preview:

```text
TECHNICAL_SPIKES_ENABLED=true
TECHNICAL_SPIKE_TOKEN=<random 24+ character secret>
BLOB_STORE_ID=<injected by the connected private Blob Store>
VERCEL_OIDC_TOKEN=<injected and rotated by Vercel>
```

Connect the private Blob Store to the Preview environment. Never log the token, credentials or
returned signed URLs. Keep `TECHNICAL_SPIKES_ENABLED=false` in Production.

For a deployment protected by Vercel Authentication, create an automation bypass secret and expose
it only to the machine running the smoke test as `VERCEL_AUTOMATION_BYPASS_SECRET`. The verifier
injects that header only into requests to the deployment origin; it never forwards the secret to
Blob upload/download origins.

## Preview smoke test

1. Confirm the Vercel deployment and GitHub checks are green.
2. `GET /api/health` returns 200, a semantic app version and `x-request-id`.
3. `GET /api/health/ready` returns 200 against the preview Atlas database.
4. Public pages have static-compatible CSP; `/studio/new` has nonce CSP.
5. `/studio/spikes` completes template PLAY → COMPLETE → DESTROY → reload.
6. With spike configuration, run MongoDB and one non-sensitive Vercel Blob upload probe.
7. Prefer `pnpm test:spikes`; it verifies the signed derivative and then deletes both temporary Blob
   objects through the protected cleanup endpoint.
8. Confirm logs contain request ID/error name only—not URI, token, gift content or signed URL.

Before enabling a production database, keep `/api/health/ready` behind the platform's deployment
protection or add a Vercel Firewall rate-limit rule. Liveness can remain public; readiness performs a
real dependency probe and should not be an unrestricted high-volume endpoint.

## Application rollback

1. Identify the last green deployment and the first bad deployment.
2. Stop promotion. If a feature flag can contain impact, disable it first.
3. In Vercel Deployments, select the last green deployment and promote/redeploy it, or revert the bad
   Git commit so Git history reflects the rollback.
4. Do not reverse a database migration unless its reviewed rollback is known safe. Sprint 1 database
   changes use expand/contract compatibility so the previous app can still run.
5. Re-run health, readiness and the affected smoke test.
6. Record deployment IDs, commit SHAs, impact, mitigation and follow-up owner.

## Template rollback

Published artifacts are immutable. Roll back the registry pointer for new gifts or activate the
template kill switch; never overwrite an artifact referenced by existing gifts.

## Escalation

- Readiness failure: verify Atlas allowlist/credentials and region before changing code.
- Viewer/template failure: disable the affected version and retain the static fallback.
- Blob failure: disable upload initialization; existing private objects remain private.
- Suspected credential exposure: disable spike endpoints, revoke/rotate credentials and review logs.
