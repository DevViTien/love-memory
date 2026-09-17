# Deployment pipeline and rollback runbook

## Purpose

Keep Vercel Hobby usage predictable while promoting the same tested code through development,
staging and production. Vercel's Git integration is the only deployment mechanism. GitHub Actions
validates code but never deploys it.

Vercel Hobby does not provide Custom Environments. Development and staging therefore use two
long-lived Preview branches with branch-specific URLs and environment-variable overrides.

## Environment matrix

| Tier        | Git branch | Vercel target | Stable URL                                                   | MongoDB database          |
| ----------- | ---------- | ------------- | ------------------------------------------------------------ | ------------------------- |
| Local       | feature/*  | None          | `http://localhost:3000`                                      | `love_memory_local`       |
| Development | `dev`      | Preview       | `https://love-memory-git-dev-devvitiens-projects.vercel.app` | `love_memory_development` |
| Staging     | `stg`      | Preview       | `https://love-memory-git-stg-devvitiens-projects.vercel.app` | `love_memory_staging`     |
| Production  | `main`     | Production    | `https://love-memory-tawny.vercel.app`                       | `love_memory_production`  |

Development and staging can share provider accounts, but they must not share MongoDB databases or
authentication base URLs. Production secrets remain Production-scoped. Preview values that differ
between `dev` and `stg` are configured as branch-specific overrides.

## Deployment allowlist

`apps/web/vercel.json` allows automatic deployments only for `dev`, `stg` and `main`. Its catch-all
rule disables deployments for every other branch, including feature and Dependabot branches.

Do not use `vercel`, `vercel deploy` or `vercel --prod` in the normal delivery flow. Those commands
bypass the branch promotion history and create additional deployments. Use the CLI only for
read-only diagnostics or an explicitly documented recovery.

## Development and promotion flow

1. Pull `dev` and create a local `feature/<name>` or `fix/<name>` branch.
2. Implement and exercise the change with `pnpm dev` at `http://localhost:3000`.
3. Run `pnpm verify:local`. It checks secrets, formatting, lint, types, unit coverage, dependency
   audit, production build and the installed-Chrome E2E suite.
4. Merge the tested change into `dev` and push `dev`. Vercel updates only the development URL.
5. Smoke-test `/`, `/api/health/ready` and the changed journey on the development URL.
6. Promote `dev` into `stg` without adding unrelated changes, then push `stg`.
7. Repeat the smoke test on the staging URL.
8. Promote `stg` into `main`. The push to `main` is the only normal Production deployment trigger.
9. Verify Production health, logs and the affected journey.

If a feature branch must be pushed for collaboration or a pull request, it still runs the applicable
GitHub checks but does not create a Vercel deployment.

## Environment variables

Configure shared Preview secrets once and override environment identity per branch:

| Variable             | `dev` Preview branch                                      | `stg` Preview branch                                  | Production                  |
| -------------------- | --------------------------------------------------------- | ----------------------------------------------------- | --------------------------- |
| `APP_URL`            | Development stable URL                                    | Staging stable URL                                    | Production stable URL       |
| `BETTER_AUTH_URL`    | Development stable URL                                    | Staging stable URL                                    | Production stable URL       |
| `MONGODB_DATABASE`   | `love_memory_development`                                 | `love_memory_staging`                                 | `love_memory_production`    |
| `MONGODB_URI`        | Shared Preview secret or dedicated development credential | Shared Preview secret or dedicated staging credential | Dedicated Production secret |
| `BETTER_AUTH_SECRET` | Shared Preview secret or a branch-specific secret         | Shared Preview secret or a branch-specific secret     | Dedicated Production secret |
| `RESEND_API_KEY`     | Preview secret                                            | Preview secret                                        | Production secret           |

`AUTH_EMAIL_FROM` and the Vercel Blob connection may be shared across Preview branches during the
current stage. Technical-spike endpoints stay disabled unless a time-boxed verification explicitly
requires them.

## Smoke test

For each deployed tier:

1. Confirm the deployment is `Ready` and the stable branch/domain alias points to it.
2. Confirm `GET /` and `GET /api/health/ready` return `200`.
3. Confirm the template catalog loads from the database assigned to that tier.
4. Test magic-link authentication using that tier's stable URL; callback URLs must not cross tiers.
5. Review Vercel error logs without exposing URIs, tokens, gift content or signed Blob URLs.

## Rollback

1. Stop promotion at the first failing tier.
2. Revert the bad Git commit on that branch and push the revert. Do not deploy an untracked local
   build over the branch domain.
3. If Production is affected, revert on `main`, then reconcile `stg` and `dev` so branch history does
   not reintroduce the defect.
4. Do not reverse a database migration unless its reviewed rollback is known safe. Prefer compatible
   expand/contract migrations.
5. Re-run readiness and the affected smoke test, and record the commit and deployment IDs.

Published template artifacts are immutable. Roll back their registry pointer or activate the
template kill switch; never overwrite an artifact referenced by an existing gift.

## Escalation

- Readiness failure: verify the tier-specific database name, Atlas allowlist and credential scope.
- Authentication failure: verify `APP_URL` and `BETTER_AUTH_URL` match the stable URL for that branch.
- Blob failure: disable new uploads while retaining existing private objects.
- Suspected credential exposure: stop promotion, revoke or rotate the credential and review logs.
