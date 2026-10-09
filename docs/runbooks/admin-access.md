# Admin access runbook

The admin area (`/admin`, `/admin/audit`, `/api/admin/*`) lets the operations team look up a gift
and read the audit log. The behavior is specified in `openspec/specs/admin-access` and
`openspec/specs/audit-log`. The design is in
[architecture.md](../architecture.md#admin-access-and-audit).

Who gets in:

- **Not an admin** (no session, or a creator): the not-found page, or `404` on an API route. The
  area never confirms it exists.
- **An admin without a valid step-up:** redirected to `/admin/mfa`.
- **An admin with a step-up:** the step-up comes from an authenticator-app code. It lasts 12 hours
  and is bound to one browser session.

## Commands

Every command takes `--operator <name>`, the name recorded as the audit actor. Each runs in one
MongoDB transaction together with its audit record, and prints one JSON line holding the user id but
never the email. They read configuration like `db:migrate` (root `.env`, then
`apps/web/.env.local`), so set `MONGODB_URI` and `MONGODB_DATABASE` to the **intended tier's**
database first.

| Command                                          | Effect                                                                                                         | Audit action         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------- |
| `pnpm admin:grant <email> --operator <name>`     | Sets the role to `admin`. Does nothing if the user is already an admin.                                        | `admin.role.granted` |
| `pnpm admin:revoke <email> --operator <name>`    | Sets the role to `creator`, and deletes every session and step-up. Does nothing for a creator.                 | `admin.role.revoked` |
| `pnpm admin:reset-mfa <email> --operator <name>` | Removes the second factor (and its lock), sets `twoFactorEnabled` to false, deletes every session and step-up. | `admin.mfa.reset`    |

Failures exit with a non-zero status and change nothing:

- `User not found: <email>`: the person must sign in once by magic link first;
- `Missing operator name`;
- a failed audit write.

## Granting the first admin of a tier

1. The person signs in once on the tier (`/auth/sign-in`), which creates the user.
2. An operator with database access to that tier runs
   `pnpm admin:grant <email> --operator <your name>`.
3. The person opens `/admin`, is sent to `/admin/mfa`, and enrolls (next section).
4. Smoke test:
   - a lookup by `publicId` shows the summary;
   - `/admin/audit` lists `admin.role.granted`, `admin.mfa.enrolled` and the lookup;
   - a creator gets `404` on `/admin`.

Each tier (`dev`, `stg`, Production) has its own users, so grant each admin per tier.

## Enrollment and backup codes

On `/admin/mfa`, `Tạo mã thiết lập` shows three things:

- the setup key, to type into Google Authenticator, Microsoft Authenticator, 1Password or similar;
- the `otpauth://` link;
- 10 backup codes.

The admin then enters the current 6-digit code. The first valid code activates the factor, records
`admin.mfa.enrolled`, and replaces the session cookie.

- **Backup codes.** They are shown only once. Each works once, in place of an authenticator code.
  Store them offline (a password manager or paper), never in chat or email.
- **Before activation.** Until the first code is accepted, `Tạo mã thiết lập` can be used again.
  It replaces the secret and the codes.
- **After activation.** The factor cannot be changed from the browser: the plugin's own
  `/api/auth/two-factor/*` endpoints answer `404`. A new factor needs `admin:reset-mfa`.

## Wrong codes and lockout

- **Wrong code.** Each wrong code answers `Mã không đúng` and is recorded as `admin.mfa.failed`
  (the code itself is never recorded).
- **Lockout.** After 10 consecutive wrong codes the factor is locked for 15 minutes, and every code,
  even a valid one, is refused.
- **Rate limit.** Separately, `/api/admin/mfa/verify` accepts at most 10 attempts per admin per 10
  minutes.

Both limits clear on their own. A reset is needed only for a lost device.

## Lost device

1. **Confirm the person's identity outside email**: a call or an in-person check by someone who
   knows them. Email alone is not enough, because the sign-in itself is by email.
2. Run `pnpm admin:reset-mfa <email> --operator <your name>`. This signs the admin out everywhere.
3. The admin signs in again and enrolls a new factor at `/admin/mfa`.

If the device was **stolen** rather than lost, also consider `admin:revoke` until the person
confirms that the email account itself is safe.

## Revocation

Run `pnpm admin:revoke <email> --operator <your name>` when someone leaves the team or an account is
suspected compromised. It takes effect on the next request:

- all sessions end;
- step-ups go with them.

The factor stays stored but grants nothing without the role. Run `admin:reset-mfa` as well if the
role may be granted again later to the same person on a new device.

## Reading the audit page

`/admin/audit` lists the latest 100 records, newest first. Times are shown as `HH:mm dd/MM/yyyy`
(Vietnam time). `/admin/audit?target=<id>` shows the records of one gift or user. The lookup
summary links to it (`Nhật ký của món quà này`).

Each record shows:

- the actor (`admin:<user id>`, `operator:<name>` or `system:<job type>`);
- the action;
- the target (`gift:<internal id>`, `user:<user id>` or `—`);
- its metadata (for example `matched=true`, `method=totp`, `reason=invalid`).

What the log never holds:

- gift text, captions, emails, share ids, codes, tokens or URLs;
- the searched text of a lookup, because a share id is a recipient's credential.

Viewing the page is not recorded. Records expire after 365 days and cannot be edited or deleted
through the application.

## Audit actions

| Action                 | Actor      | Target | Metadata                                 |
| ---------------------- | ---------- | ------ | ---------------------------------------- |
| `admin.role.granted`   | `operator` | user   | —                                        |
| `admin.role.revoked`   | `operator` | user   | —                                        |
| `admin.mfa.reset`      | `operator` | user   | —                                        |
| `admin.mfa.enrolled`   | `admin`    | user   | `method`                                 |
| `admin.mfa.verified`   | `admin`    | user   | `method` (`totp` or `backup`)            |
| `admin.mfa.failed`     | `admin`    | user   | `method`, `reason` (`invalid`, `locked`) |
| `admin.gift.looked_up` | `admin`    | gift   | `matched`; no target when nothing found  |
