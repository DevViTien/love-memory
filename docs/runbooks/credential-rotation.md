# Credential rotation runbook

How to replace each secret the application reads, what breaks while you do, and in which order.
Owner: Tech Lead. Rotate immediately after a suspected exposure. Otherwise rotate at least yearly,
and whenever someone with access leaves.

**Golden rules:**

- Change the value in the Vercel project for the right environment (`dev` Preview branch, `stg`
  Preview branch or Production) and in the Trigger.dev environment when the task needs it. Then
  redeploy that tier from its branch; never run an ad-hoc `vercel deploy`.
- Never paste a secret into chat, an issue, a commit or a log. `pnpm test:secrets` catches common
  key formats in the repository.
- After every rotation, check `/api/health/ready` and the affected journey on the tier.

## Secrets

| Variable                      | Protects                                                             | Effect of rotating                                                                                                                                                                                                                                                                               | Steps                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`          | Session cookies, admin factor encryption, rate-limit subject hashing | Without a rollover every user is signed out, rate-limit counters restart, and **enrolled admin factors can no longer be decrypted**: run `pnpm admin:reset-mfa` for each admin afterwards. Prefer Better Auth's multi-secret rollover (new secret first, old one accepted until sessions renew). | Generate 32+ random bytes; set it; redeploy; reset admin factors if no rollover was used; ask admins to enroll again.                                           |
| `MONGODB_URI`                 | All data                                                             | None if the new user has the same roles.                                                                                                                                                                                                                                                         | Create a new Atlas database user with the same roles; set the URI; redeploy the tier and its Trigger.dev environment (`pnpm jobs:deploy`); delete the old user. |
| `RESEND_API_KEY`              | Magic-link and system emails                                         | Sign-in emails fail between revocation and redeploy; system emails retry, then end `dead` (`pnpm jobs:retry`).                                                                                                                                                                                   | Create a new key in Resend; set it in Vercel and Trigger.dev; redeploy; revoke the old key.                                                                     |
| `BLOB_READ_WRITE_TOKEN`       | Private photos (Vercel Blob)                                         | Uploads and processing fail until both the app and Trigger.dev have the new token. Signed URLs already issued expire within 5 minutes.                                                                                                                                                           | Rotate in the Vercel Blob store; set it in Vercel and Trigger.dev; redeploy; `pnpm jobs:deploy`.                                                                |
| `PAYOS_API_KEY`               | payOS API calls (checkout)                                           | Checkouts answer `PAYMENT_PROVIDER_UNAVAILABLE` until the new key is deployed.                                                                                                                                                                                                                   | Create a new key in the payOS channel; set it; redeploy; revoke the old key.                                                                                    |
| `PAYOS_CHECKSUM_KEY`          | Signatures of payOS requests and responses                           | Every payOS answer fails verification until the new key is deployed, so checkouts fail.                                                                                                                                                                                                          | Rotate it in the payOS channel and set it in Vercel at the same time; redeploy.                                                                                 |
| `TRIGGER_SECRET_KEY`          | Dispatching background jobs                                          | Dispatch fails; jobs wait in the outbox and `jobs-sweep` runs them once Trigger.dev is reachable again (readiness reports stalls after 10 minutes).                                                                                                                                              | Create a new key in the Trigger.dev environment; set it; redeploy.                                                                                              |
| `ANALYTICS_GIFT_REF_SECRET`   | Pseudonymous gift references in analytics                            | Events before and after cannot be joined, and deleting a gift no longer finds its older events (they expire in 180 days).                                                                                                                                                                        | Follow "Rotating the analytics gift-ref secret" in the [deployment runbook](./preview-deploy-and-rollback.md).                                                  |
| `LOCAL_OBJECT_STORAGE_SECRET` | Signed URLs of the local storage driver (development and E2E only)   | Local signed URLs stop working. Never set on Vercel.                                                                                                                                                                                                                                             | Change it in the local `.env`.                                                                                                                                  |
| `TECHNICAL_SPIKE_TOKEN`       | Technical spike routes (off unless `TECHNICAL_SPIKES_ENABLED`)       | Spike scripts need the new token.                                                                                                                                                                                                                                                                | Change it where spikes are enabled; keep spikes disabled on Production.                                                                                         |

Non-secret configuration (`APP_URL`, `BETTER_AUTH_URL`, `MONGODB_DATABASE`, `ASSET_ORIGIN`,
`AUTH_EMAIL_FROM`, `MEDIA_WORKER_MODE`, `STORAGE_DRIVER`, `INTERNAL_PLAN_GRANT_ENABLED`,
`ANALYTICS_ENABLED`, `BILLING_PROVIDER`, `PAYOS_CLIENT_ID`) needs no rotation; it is listed in the deployment runbook.

## Session and cookie review (2026-10-10)

Reviewed for `change-security-hardening`; no change needed.

- **Auth cookies.** Better Auth cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production
  builds. Every Vercel tier is a production build, so every deployed tier sets `Secure`.
- **Sessions.** They last 30 days and their expiry is extended at most once per 24 hours. The only
  trusted origin is the tier's own URL.
- **Magic links.** They expire after 10 minutes, are stored hashed, and are limited to 5 per 5
  minutes per address.
- **The anonymous draft cookie.** It is `HttpOnly`, `SameSite=Lax`, lasts 30 days, and is `Secure`
  in production. Its value carries a claim token that is stored only as a hash.
- **Admins.** They additionally need a TOTP step-up per session (12 hours); see the
  [admin access runbook](./admin-access.md).
- **`__Host-` prefixes** were considered and rejected: renaming live cookies signs every user out,
  and the `Secure` plus same-site guarantees already hold on HTTPS-only tiers.
