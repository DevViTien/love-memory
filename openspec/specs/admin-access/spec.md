# admin-access Specification

## Purpose

Lets a small operations team act on gifts safely. Only accounts granted the admin role by an
operator command, holding an authenticator-app second factor and a fresh per-session step-up, can
reach the admin area. Everyone else cannot tell that it exists.

## Requirements

### Requirement: Admin role and operator commands

A user SHALL be an admin exactly when their `role` is `admin`. No API, page or Better Auth endpoint
SHALL change a role. The system SHALL provide these operator commands. Each requires
`--operator <name>` (a non-empty name, recorded as the audit actor), reads configuration like
`db:migrate`, exits with a non-zero status on failure, and closes the MongoDB client:

- **`pnpm admin:grant <email>`** SHALL set the role of the user with that email to `admin` and
  record `admin.role.granted`.
- **`pnpm admin:revoke <email>`** SHALL set the role to `creator`, delete every session of the user
  and every admin step-up of those sessions, and record `admin.role.revoked`.
- **`pnpm admin:reset-mfa <email>`** SHALL remove the user's second factor (the user can enroll
  again), delete every session and step-up of the user, and record `admin.mfa.reset`.

An email that matches no user SHALL fail with `User not found: <email>` and change nothing.
Granting an admin, or revoking a creator, SHALL change nothing and record nothing.

#### Scenario: Grant then revoke

- **WHEN** an operator runs `pnpm admin:grant owner@example.test --operator lan` and later
  `pnpm admin:revoke owner@example.test --operator lan`
- **THEN** the user is an admin in between, and afterwards a `creator` with no session left
- **AND** the audit log holds `admin.role.granted` and `admin.role.revoked`, with the actor
  `operator` `lan` and the user's id as target

#### Scenario: Unknown email

- **WHEN** an operator runs `pnpm admin:grant nobody@example.test --operator lan`
- **THEN** the command fails with `User not found: nobody@example.test`, and nothing is recorded

#### Scenario: Missing operator name

- **WHEN** an operator runs `pnpm admin:grant owner@example.test` without `--operator`
- **THEN** the command fails, and the role is unchanged

### Requirement: Admin area guard

The admin area is `/admin`, every path under `/admin/`, and every route under `/api/admin/`. The
system SHALL evaluate, for every request to it, after the session is read and before any admin data
is accessed:

1. **Not an admin.** For a request without a session, or whose user is not an admin, pages SHALL
   render the application's not-found page with HTTP `404`. Routes SHALL answer `404` with code
   `NOT_FOUND`, identical to an unknown API path.
2. **No step-up.** For an admin without an enabled second factor, or without a valid step-up for the
   current session (see "Admin step-up"), every page except `/admin/mfa` SHALL redirect to
   `/admin/mfa`. Every route except `POST /api/admin/mfa/enroll` and `POST /api/admin/mfa/verify`
   SHALL answer `403` with code `FORBIDDEN` and `details.reason` `MFA_REQUIRED`.
3. **Admin with a valid step-up.** The request proceeds.

Every admin response SHALL be dynamically rendered, carry `Cache-Control: no-store`,
`X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer` (a search query can hold a share id), and
use the nonce CSP (`content-security-policy`). The admin area SHALL work
the same in every environment.

#### Scenario: Creator sees nothing

- **WHEN** a signed-in creator opens `/admin` or `/admin/audit`
- **THEN** the not-found page is rendered with HTTP `404`, the same as for `/admin-does-not-exist`

#### Scenario: Signed-out visitor sees nothing

- **WHEN** a browser without a session opens `/admin`
- **THEN** the response is the same not-found page with HTTP `404`

#### Scenario: Admin without a step-up

- **WHEN** an admin with an enabled factor opens `/admin` in a session that has no valid step-up
- **THEN** the browser is redirected to `/admin/mfa`

#### Scenario: Admin API without a step-up

- **WHEN** an admin without a valid step-up calls an admin route other than the two MFA routes
- **THEN** the response is `403` with code `FORBIDDEN` and `error.details.reason` `MFA_REQUIRED`

### Requirement: Admin second factor enrollment

The second factor SHALL be an authenticator app (TOTP, 6 digits, 30-second period, issuer
`LoveMemory`) with 10 single-use backup codes. Both SHALL be stored only in encrypted form.

**Enrollment.** `POST /api/admin/mfa/enroll` (strict empty JSON body, passing the guards of
`mutation-request-guards`) SHALL be allowed only for an admin without an enabled factor. It SHALL
answer `201` with `data` holding exactly `totpUri` (`otpauth://totp/…`), `setupKey` (the base32
secret) and `backupCodes`. Calling it again before the factor is enabled SHALL replace the pending
secret and codes. For an admin whose factor is already enabled, it SHALL answer `409` with code
`CONFLICT` and `details.reason` `MFA_ALREADY_ENABLED`, and change nothing.

**Activation.** The first valid code sent to `POST /api/admin/mfa/verify` SHALL enable the factor
and record `admin.mfa.enrolled`.

**The page.** `/admin/mfa` SHALL show:

- for an admin without an enabled factor: an enrollment step that requests the setup and shows the
  setup key, the URI and the backup codes once, with the text `Lưu các mã dự phòng ở nơi an toàn.
Mỗi mã chỉ dùng được một lần.`, then the code form;
- for an enrolled admin: only the code form.

**Plugin endpoints disabled.** Better Auth's own two-factor HTTP endpoints (every path under
`/api/auth/two-factor/`) SHALL answer `404`, so no browser request can enroll, disable or reset a
factor outside the admin routes.

#### Scenario: First enrollment

- **WHEN** a newly granted admin opens `/admin`, is redirected to `/admin/mfa`, sets up the
  authenticator from the shown setup key, and submits a current code
- **THEN** the factor is enabled, `admin.mfa.enrolled` is recorded, and the admin reaches `/admin`

#### Scenario: Re-enrollment refused

- **WHEN** an admin whose factor is enabled sends `POST /api/admin/mfa/enroll`
- **THEN** the response is `409` with code `CONFLICT` and `error.details.reason`
  `MFA_ALREADY_ENABLED`, and the factor is unchanged

#### Scenario: Plugin endpoint unreachable

- **WHEN** any signed-in user sends `POST /api/auth/two-factor/enable` or
  `POST /api/auth/two-factor/disable`
- **THEN** the response is `404`, and no factor changes

#### Scenario: Creator cannot enroll

- **WHEN** a creator sends `POST /api/admin/mfa/enroll`
- **THEN** the response is `404` with code `NOT_FOUND`

### Requirement: Admin step-up

`POST /api/admin/mfa/verify` SHALL take a strict JSON body `{ "code": <string> }` holding either a
6-digit TOTP code or one backup code. It SHALL be rate limited under the scope `admin-mfa`
(`mutation-request-guards`), and SHALL verify the code against the admin's factor:

- **Success.** It records a step-up for the current session that expires 12 hours later, records
  `admin.mfa.verified`, and answers `200`. A backup code is consumed by its use.
- **Wrong code.** It records `admin.mfa.failed` and answers `400` with code `VALIDATION_ERROR` and
  `fieldErrors.code`. After 10 failed codes the factor is locked for 15 minutes, and every code,
  even a valid one, then answers `429` with code `RATE_LIMITED` and `details.retryAfterSeconds`.

A step-up SHALL be bound to one session. It SHALL end when it expires, when that session ends
(sign-out or expiry), when the admin role is revoked, or when the factor is reset. The code MUST NOT
appear in any log or audit record.

#### Scenario: Step-up with a TOTP code

- **WHEN** an enrolled admin submits a current code on `/admin/mfa`
- **THEN** the response is `200`, the admin reaches `/admin`, and `admin.mfa.verified` is recorded

#### Scenario: Wrong code

- **WHEN** an enrolled admin submits `000000` while it is not the current code
- **THEN** the response is `400` with `error.fieldErrors.code`, and `/admin` still redirects to
  `/admin/mfa`

#### Scenario: Backup code used once

- **WHEN** an admin steps up with a backup code, signs out, signs in again, and submits the same
  backup code
- **THEN** the first step-up succeeds, and the second is refused with `400`

#### Scenario: Step-up expires

- **WHEN** an admin stepped up 12 hours ago in the same session
- **THEN** `/admin` redirects to `/admin/mfa` again

#### Scenario: Step-up does not travel between sessions

- **WHEN** an admin stepped up in one browser and signs in in another
- **THEN** the second session has no step-up and is redirected to `/admin/mfa`

### Requirement: Admin gift lookup

`/admin` SHALL offer a search field labelled `Tìm món quà` that accepts a gift's `publicId`,
`shareId` or internal id. It SHALL be found by an exact match on one of those three fields, never
by content.

**A match** SHALL show only:

- the internal id, `publicId` and status;
- the template id and version;
- the plan id and `expiresAt`;
- `revision` and `publishedRevision`;
- the creation, update and publication times;
- the owner's user id and email, or `Bản nháp ẩn danh` for an anonymous draft;
- the number of the gift's assets per status.

It MUST NOT show content, captions, field values, asset ids, storage keys, share links or signed
URLs. Only the `shareId` the admin typed may appear, in the search field.

**No match** SHALL show `Không tìm thấy món quà nào.`

**Audit.** Every search SHALL record `admin.gift.looked_up`:

- with the gift as target and `{ matched: true }` for a match;
- without a target and with `{ matched: false }` otherwise.

The searched text MUST NOT be recorded, because a share id is a recipient's credential.

#### Scenario: Lookup by public id

- **WHEN** a stepped-up admin searches for a published gift's `publicId`
- **THEN** the page shows its status `published`, its template, plan, expiry, owner email and asset
  counts, and no caption or text of the gift
- **AND** `admin.gift.looked_up` is recorded with the gift's internal id as target

#### Scenario: Lookup by share id is not leaked

- **WHEN** a stepped-up admin searches for a gift's `shareId`
- **THEN** the gift is found, and the audit record holds the gift's internal id but not the share id

#### Scenario: Nothing found

- **WHEN** a stepped-up admin searches for a value that matches no gift
- **THEN** the page shows `Không tìm thấy món quà nào.`, and the audit record has no target and
  `{ matched: false }`
