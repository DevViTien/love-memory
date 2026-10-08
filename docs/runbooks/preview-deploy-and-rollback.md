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

### Database migrations during promotion

When a promotion raises `DATABASE_SCHEMA_VERSION`, run `pnpm db:migrate` against that tier's
database as soon as its deployment is `Ready`, then `pnpm db:verify` and `pnpm db:verify-gifts`.

Schema version `10` (`change-gift-publication-revisions`):

- adds `publishedRevision` to `gifts` and `detachedAt` to `assets`;
- drops the legacy index `giftPublications.gift_publications_share_id_unique`;
- backfills `publishedRevision = revision` on every published gift that has none.

Until it runs, the new build serves published gifts normally, but an update of a published gift
(`Cập nhật món quà`) answers `500`: the legacy unique index rejects a second publication with the
same share id. Recipients keep the first publication.

## Environment variables

Configure shared Preview secrets once and override environment identity per branch:

| Variable                    | `dev` Preview branch                                      | `stg` Preview branch                                  | Production                                       |
| --------------------------- | --------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| `APP_URL`                   | Development stable URL                                    | Staging stable URL                                    | Production stable URL                            |
| `BETTER_AUTH_URL`           | Development stable URL                                    | Staging stable URL                                    | Production stable URL                            |
| `MONGODB_DATABASE`          | `love_memory_development`                                 | `love_memory_staging`                                 | `love_memory_production`                         |
| `MONGODB_URI`               | Shared Preview secret or dedicated development credential | Shared Preview secret or dedicated staging credential | Dedicated Production secret                      |
| `BETTER_AUTH_SECRET`        | Shared Preview secret or a branch-specific secret         | Shared Preview secret or a branch-specific secret     | Dedicated Production secret                      |
| `RESEND_API_KEY`            | Preview secret                                            | Preview secret                                        | Production secret                                |
| `INTERNAL_PUBLISH_ENABLED`  | `true`                                                    | `true`                                                | Absent (forced off anyway)                       |
| `ANALYTICS_ENABLED`         | `true`                                                    | `true`                                                | Absent (off) until the Product Owner turns it on |
| `ANALYTICS_GIFT_REF_SECRET` | 48 random bytes, base64url; development only              | 48 random bytes, base64url; staging only              | Its own 48 random bytes, provisioned now         |
| `MEDIA_WORKER_MODE`         | `trigger`, or `inline` until Trigger.dev is configured    | `trigger`                                             | `trigger`                                        |
| `TRIGGER_SECRET_KEY`        | Secret of its Trigger.dev environment (never `tr_dev_…`)  | Secret of its Trigger.dev environment                 | Trigger.dev Production secret                    |
| `TRIGGER_PROJECT_REF`       | LoveMemory Trigger.dev project ref                        | LoveMemory Trigger.dev project ref                    | LoveMemory Trigger.dev project ref               |

The media worker variables and the Trigger.dev task deployment are described in the
[media pipeline runbook](./media-pipeline.md#worker-mode-per-deployment). If the smoke test finds
`/api/health/ready` at `503` with `MediaOutboxStalledError` in the logs, uploads are not being
processed on that deployment.

`AUTH_EMAIL_FROM` and the Vercel Blob connection may be shared across Preview branches during the
current stage. Technical-spike endpoints stay disabled unless a time-boxed verification explicitly
requires them.

`INTERNAL_PUBLISH_ENABLED` is the Sprint 3 stand-in for a publish entitlement. Only the exact value
`true` enables publishing, and the application forces it off whenever `VERCEL_ENV` is `production`,
so Production cannot publish until Sprint 4 brings real entitlements. Never set it in Production.

`ANALYTICS_ENABLED` turns on first-party funnel analytics ([ADR-0010](../adr/0010-first-party-funnel-analytics.md)).
Only the exact value `true` enables it, and only with an `ANALYTICS_GIFT_REF_SECRET` of at least 32
characters; anything else runs with analytics off and logs `analytics_misconfigured` once (never
the value). Production stays off by accepted product decision until the Sprint 6 privacy notice and
consent copy ship; turning it on is this variable alone, no code change. Generate each secret with
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`; it is dedicated
(never `BETTER_AUTH_SECRET` or `LOCAL_OBJECT_STORAGE_SECRET`) and never shared between environments.

### Rotating the analytics gift-ref secret

`ANALYTICS_GIFT_REF_SECRET` keys `giftRef`, the pseudonym that joins a gift's Studio, server and
recipient events. Rotate it only when the value may be exposed (a leaked environment, a departing
member with access to it), not on a schedule:

1. generate a new 48-byte base64url value for that environment only, and replace the variable;
2. redeploy the branch so new requests read it.

Every gift then gets a new `giftRef`: events recorded before and after the rotation cannot be
joined, and a funnel that spans the rotation splits in two. Stored events stay valid and expire by
their 180-day TTL; no data migration is needed. The value is never logged, never shared between
environments, and never copied into tickets or chat. No key id is stored; if a planned rotation is
ever needed, a `giftRefKeyVersion` field is a later additive change.

### Share links in platform logs

A published gift is opened at `/g/{shareId}`, and the share id is a bearer secret: anyone with the
link can open the gift. The application never writes share ids, payloads or signed URLs to its own
logs, sends `Referrer-Policy: no-referrer` and `Cache-Control: private, no-store` on `/g/`, and the
development request log ignores `/g/` and `/api/public-gifts/`. The hosting platform still records
request paths:

- Vercel runtime and request logs keep `/g/{shareId}` and `/api/public-gifts/{shareId}` paths. The
  application cannot remove them.
- Who can read them: only members of the Vercel team with access to the `love-memory` project (the
  Owner and Member roles; Viewer-role members too, where the plan offers that role). Review that
  membership together with the Production secret owners, and remove members who no longer need it.
- Retention: how long Vercel keeps runtime logs and request history depends on the project's
  Vercel plan and on any configured log drain (none is configured). Check the plan's current
  limits in the Vercel dashboard or documentation before relying on a number, and again whenever
  the plan changes.
- No log drain may be configured until it strips `/g/` and `/api/public-gifts/` paths (or the share
  id segment) before storage.
- Links cannot be revoked or re-issued until the pause and delete work of Sprint 4 (plan.md
  §13.1–13.2). Editing a published gift keeps its link: an update changes what the link shows, not
  the link. Only `dev` and `stg` can publish, so only test gifts are exposed.

## Deployment Protection and template artifacts

Vercel Deployment Protection (Vercel Authentication, the default "Standard Protection" for Preview
deployments) breaks every animated gift on a protected tier. The template iframe runs with
`sandbox="allow-scripts"` and therefore has an opaque origin, so the browser sends its
`runtime.mjs` module request without the Vercel SSO cookie. Vercel answers `302` to
`vercel.com/sso-api`, the runtime never starts, and the gift viewer shows its static fallback after
the `INIT` handshake times out (the preview then shows `Đang hiển thị bản tĩnh vì mẫu quà không chạy
được…`). The application cannot work around this: the request is refused before it reaches Next.js,
and published template releases are immutable.

Check a tier without signing in (the hash is in `templates/memory-box/releases/1.1.0/artifact.json`):

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "<stable URL>/template-artifacts/memory-box/1.1.0/<contentHash>/runtime.mjs"
```

`200` means templates can run; `302`/`401` means the tier is protected. Options, decided with the
PO (risk register "Staging publishing is open to any signed-in account", decision P4):

- disable Vercel Authentication for `dev`/`stg` and restrict access in the application (email
  allowlist) instead; or
- keep the protection only where no animated gift has to be demonstrated, accepting the static
  fallback there.

Do not put the Protection Bypass for Automation secret into artifact URLs: it would reach every
viewer of a preview or published gift.

## Smoke test

For each deployed tier:

1. Confirm the deployment is `Ready` and the stable branch/domain alias points to it.
2. Confirm `GET /` and `GET /api/health/ready` return `200`.
3. Confirm the template catalog loads from the database assigned to that tier.
4. Test magic-link authentication using that tier's stable URL; callback URLs must not cross tiers.
5. Confirm the template artifact check of "Deployment Protection and template artifacts" returns
   `200`, then open a preview and confirm the Memory Box animation plays (not the static view).
6. Review Vercel error logs without exposing URIs, tokens, gift content or signed Blob URLs.

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

### Rolling back past schema version 8 (published gifts)

Schema version `8` adds `giftPublications` and the optional `shareId` and `publishedAt` fields of
published gifts. Production cannot publish (the flag is forced off), so a Production rollback is
clean. On `dev` and `stg`, the previous build parses gift documents strictly and fails on published
gifts: `/studio/{publicId}` of a published gift and its media routes answer `500` until a roll
forward, and `/g/` does not exist. In order of preference:

1. roll forward with a fix instead of rolling back;
2. roll back and accept those `500`s for the few test gifts until the roll forward;
3. for a clean rollback, first set `INTERNAL_PUBLISH_ENABLED=false`, then move the published test
   gifts out of the way with a one-off script that is written and reviewed at that time (for
   example `$unset` `shareId`/`publishedAt` and set `status: "draft"`, keeping `giftPublications`
   for a later restore). Never run it ad hoc.

The old `db:verify` reports drift after a rollback; running the old `db:migrate` restores the
version `7` validators and ledger and leaves the extra `gifts_share_id_unique` index harmlessly in
place. Re-deploying version `8` later restores access without data repair.

### Rolling back past schema version 10 (editable published gifts)

Schema version `10` gives every published gift a `publishedRevision` (the backfill) and can give
assets a `detachedAt`. The previous build parses `gifts` and `assets` strictly and fails on both
fields. Production cannot publish (the flag is forced off), so a Production rollback is clean. On
`dev` and `stg`, after a rollback:

- `/studio/{publicId}` and `/g/{shareId}` of every published gift answer `500`;
- the media routes of a gift with a detached photo answer `500`.

In order of preference:

1. roll forward with a fix instead of rolling back;
2. roll back and accept those `500`s for the test gifts until the roll forward;
3. for a clean rollback, first set `INTERNAL_PUBLISH_ENABLED=false`, then run a one-off script that
   is written and reviewed at that time. For example, it can `$unset` `publishedRevision` on gifts
   whose `revision` equals it, and move gifts with unpublished changes out of the way, keeping
   every `giftPublications` record. Never run it ad hoc. Detached assets stay `ready`; unsetting
   their `detachedAt` would put them back into the working copy's quota.

The old `db:verify` reports drift after a rollback. The old `db:migrate` recreates the unique
`gift_publications_share_id_unique` index, which fails while any gift has two publications; do not
run it until those extra publications are dealt with by the reviewed script. Re-deploying version
`10` later restores access without data repair.

## Escalation

- Readiness failure: verify the tier-specific database name, Atlas allowlist and credential scope.
- Authentication failure: verify `APP_URL` and `BETTER_AUTH_URL` match the stable URL for that branch.
- Blob failure: disable new uploads while retaining existing private objects.
- Suspected credential exposure: stop promotion, revoke or rotate the credential and review logs.
