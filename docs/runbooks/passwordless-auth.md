# Passwordless authentication runbook

Sprint 1 uses Better Auth 1.7 with the native MongoDB adapter and Resend delivery. Magic-link
tokens are single-use, expire after 10 minutes and are stored as hashes. Neither URLs nor tokens
may be written to logs.

## Required environment variables

| Variable             | Example                                   | Notes                                             |
| -------------------- | ----------------------------------------- | ------------------------------------------------- |
| `BETTER_AUTH_URL`    | `https://preview.example.com`             | Exact deployment origin; HTTPS in production      |
| `BETTER_AUTH_SECRET` | generated high-entropy value              | At least 32 characters; different per environment |
| `AUTH_EMAIL_FROM`    | `LoveMemory <hello@verified.example.com>` | Sender domain must be verified in Resend          |
| `RESEND_API_KEY`     | provider secret                           | Server-only; never use a public prefix            |

`APP_URL` should use the same origin. Preview and production must not share the auth secret or
MongoDB database.

Generate a secret locally without copying it into source control:

```bash
openssl rand -base64 48
```

## Database setup

The commands read the repository `.env` and then `apps/web/.env.local` when present:

```bash
pnpm db:seed
pnpm db:verify
pnpm db:verify-gifts
```

`db:seed` is idempotent. It applies collection validators and named indexes, then upserts the three
published template manifests and their validated preview fixtures. Run it with migration credentials;
the web runtime credential only needs application read/write permissions.

`db:verify-gifts` creates a uniquely named temporary draft, verifies owner isolation, optimistic
concurrency and claim behavior against real MongoDB, then removes the draft and its revisions in a
`finally` cleanup.

## Vercel setup

1. Add all four auth variables to Preview first.
2. Set `BETTER_AUTH_URL` and `APP_URL` to the stable Preview test domain.
3. Run the database seed against the Preview database.
4. Request a link, verify delivery, use it once, and confirm a second use fails.
5. Confirm logout removes the session and an expired session no longer opens an owned draft.
6. Repeat with separate secrets, sender configuration and database for Production.

Do not use Vercel deployment URLs that change on every commit as the canonical auth URL. Add any
additional callback origin explicitly to Better Auth's trusted-origin configuration before use.

## Incident actions

- Leaked Resend key: revoke it at the provider and replace the Vercel secret.
- Leaked Better Auth secret: rotate with Better Auth's multi-secret rollover procedure, then retire
  the old value after active sessions expire.
- Suspicious login traffic: inspect rate-limit records and request IDs; never export token values.
- Email outage: leave authentication fail-closed and show the generic retry message.
