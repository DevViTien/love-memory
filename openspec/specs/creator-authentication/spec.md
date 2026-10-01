# Creator Authentication

## Purpose

Lets gift creators sign in without a password by requesting a single-use email link, keeps them signed in with a server-side session, and exposes that session state to server code and the site navigation. Gift recipients never need an account. Draft ownership and claiming are specified in `gift-draft-ownership`; guards on gift mutation endpoints are specified in `mutation-request-guards`.

## Requirements

### Requirement: Passwordless magic-link sign-in request

The system SHALL let a creator request a sign-in link by submitting only an email address from the sign-in page at `/auth/sign-in`, which calls `POST /api/auth/sign-in/magic-link`. The request SHALL carry a callback URL (the post-sign-in destination), a new-user callback URL equal to that same destination, and the error callback URL `/auth/sign-in?error=invalid-link`. The destination SHALL default to `/studio/new` and SHALL be taken from the `next` query parameter only when that value is a relative path that starts with `/` and does not start with `//`. No account needs to exist beforehand: the first successful verification of a link for a new email address creates the user.

#### Scenario: Request a link with a safe return path

- **WHEN** a signed-out visitor opens `/auth/sign-in?next=/studio/abc` and submits their email address
- **THEN** a magic-link request is sent whose callback URL and new-user callback URL are `/studio/abc`
- **AND** the error callback URL is `/auth/sign-in?error=invalid-link`

#### Scenario: Reject an unsafe return path

- **WHEN** the `next` query parameter is missing, is an absolute URL, or starts with `//`
- **THEN** the post-sign-in destination is `/studio/new`

### Requirement: Generic sign-in responses

The system MUST NOT reveal whether an email address already has an account. After a successful sign-in request, the sign-in form SHALL show the same confirmation for every address, saying that a single-use link was sent if the address is valid and that it expires after 10 minutes. The confirmation SHALL also say `Hãy mở liên kết trên cùng trình duyệt và thiết bị này để tiếp tục bản nháp của bạn.`, because a draft started without an account is held by the browser that created it (`gift-draft-ownership`). If the request fails because of a provider error or a network error, the form SHALL show a generic retry message and SHALL become usable again.

#### Scenario: Confirmation does not depend on account existence

- **WHEN** a sign-in request for any well-formed email address succeeds
- **THEN** the form is replaced by the same "check your inbox" confirmation, whether or not the address belongs to an existing user
- **AND** the confirmation asks the creator to open the link in this same browser and device

#### Scenario: Delivery or transport failure is recoverable

- **WHEN** the sign-in request returns an error or the network call throws
- **THEN** a generic "cannot send email right now, try again" message is shown
- **AND** the submit button is enabled again

### Requirement: Magic-link token lifetime and single use

Magic-link tokens SHALL expire 600 seconds (10 minutes) after they are issued. Tokens SHALL be stored only as hashes, never in plaintext. A token SHALL be consumed atomically on its first verification at `GET /api/auth/magic-link/verify`, so it cannot be used a second time. A successful verification SHALL create a session, set the session cookie, and redirect to the callback URL (or to the new-user callback URL when the verification created the user). Users created this way SHALL have a verified email, an empty display name, and the role `creator`.

#### Scenario: First use signs the creator in

- **WHEN** a creator opens an unexpired magic link for the first time
- **THEN** a session is created and the browser is redirected to the requested destination

#### Scenario: Reused or expired link is rejected

- **WHEN** a magic link is opened a second time, or more than 600 seconds after it was issued
- **THEN** no session is created
- **AND** the browser is redirected to `/auth/sign-in` with an `error` query parameter

### Requirement: Magic-link email delivery

The system SHALL send each magic link by email through the configured transactional email provider, from the configured `AUTH_EMAIL_FROM` sender. The email SHALL contain the link as an HTML button (with the URL HTML-escaped) and as plain text, and SHALL say that the link can be used only once and expires after 10 minutes. If the provider reports a delivery error, the sign-in request SHALL fail rather than report success. Only when the auth base URL is a loopback host (`localhost` or `127.0.0.1`) and `AUTH_EMAIL_CAPTURE_PATH` is set SHALL messages be written to that local file instead of being sent.

#### Scenario: Provider rejects the message

- **WHEN** the email provider returns an error for a magic-link message
- **THEN** the sign-in request fails and the creator sees the generic retry message

#### Scenario: Capture mode limited to loopback

- **WHEN** `AUTH_EMAIL_CAPTURE_PATH` is configured and the auth base URL is not a loopback host
- **THEN** authentication configuration fails to load, and no capture sender is used

### Requirement: Session lifetime and cookie policy

Creator sessions SHALL last 30 days (2592000 seconds). A session that is still in use SHALL have its expiry extended at most once every 24 hours (86400 seconds). Auth cookies SHALL be `HttpOnly` and `SameSite=Lax`, and SHALL be `Secure` when running in production. The only trusted origin for auth callbacks SHALL be the configured auth base URL origin.

#### Scenario: Session cookie attributes in production

- **WHEN** a creator completes sign-in in a production deployment
- **THEN** the session cookie is set with `HttpOnly`, `SameSite=Lax`, and `Secure`

#### Scenario: Idle session expires

- **WHEN** a session goes unused for more than 30 days
- **THEN** it no longer authenticates requests, and the creator must sign in again

### Requirement: Authentication rate limits

The system SHALL rate-limit auth endpoints with counters stored in the shared database, so limits hold across server instances. All endpoints under `/api/auth` SHALL allow at most 60 requests per 60-second window. `/api/auth/sign-in/magic-link` and `/api/auth/magic-link/verify` SHALL allow at most 5 requests per 300-second window, raised to 100 per 300-second window only in loopback email-capture mode. Rate limiting SHALL be enabled in every environment, and requests over the limit SHALL be rejected with HTTP `429`.

#### Scenario: Repeated link requests are throttled

- **WHEN** a client sends a sixth request to `/api/auth/sign-in/magic-link` within 300 seconds
- **THEN** the request is rejected with HTTP `429`, and no email is sent

### Requirement: Session state exposure to server and navigation

Server code SHALL resolve the current user from request headers as either null (no session) or a user with `id`, `email`, `name` (which may be empty), and `role` (one of `creator` or `admin`, defaulting to `creator`). Clients SHALL NOT be able to set the role. The global site header SHALL show a link labelled `Tài khoản` when the live client session has a user and `Đăng nhập` otherwise; both link to `/auth/sign-in`. When signed in, the `/auth/sign-in` page SHALL show the signed-in email address and a sign-out control instead of the email form.

#### Scenario: Navigation reflects a new session

- **WHEN** a creator completes a magic-link sign-in
- **THEN** the header shows the `Tài khoản` link to `/auth/sign-in`

#### Scenario: Navigation without a session

- **WHEN** no session exists
- **THEN** the header shows the `Đăng nhập` link to `/auth/sign-in`

### Requirement: Sign-out

The system SHALL let a signed-in creator sign out from `/auth/sign-in` through `POST /api/auth/sign-out`. Signing out revokes the session. On success the page SHALL refresh to its signed-out state, showing the email form, and the header SHALL show `Đăng nhập`. If sign-out fails because of a provider error or a network error, the page SHALL show an error message and the sign-out button SHALL become usable again.

#### Scenario: Successful sign-out

- **WHEN** a signed-in creator clicks the sign-out button and the request succeeds
- **THEN** the session is revoked, the email form is shown, and the header shows `Đăng nhập`

#### Scenario: Failed sign-out is recoverable

- **WHEN** the sign-out request returns an error
- **THEN** an error alert is shown and the sign-out button is enabled again

### Requirement: Fail-closed auth configuration

The system SHALL refuse to initialize authentication unless `BETTER_AUTH_SECRET` is at least 32 characters, `AUTH_EMAIL_FROM` is an email address or a `Name <email>` value, and `RESEND_API_KEY` is present. The auth base URL is taken from `BETTER_AUTH_URL`, falling back to `APP_URL`, and in production it MUST use HTTPS unless it is a loopback host.

#### Scenario: Insecure production URL

- **WHEN** `NODE_ENV` is `production` and the auth base URL is `http://` on a non-loopback host
- **THEN** authentication configuration fails to load

#### Scenario: Short secret

- **WHEN** `BETTER_AUTH_SECRET` is shorter than 32 characters
- **THEN** authentication configuration fails to load

### Requirement: Sign-in error explanation

A failed magic-link verification SHALL redirect to `/auth/sign-in` with an `error` query parameter.
When a signed-out visitor opens `/auth/sign-in` with a non-empty `error` value, the sign-in page
SHALL show an alert and SHALL keep the sign-in form available. For `invalid-link` and
`INVALID_TOKEN` the alert SHALL say that the sign-in link is invalid, expired, or already used and
that a new link should be requested. For any other `error` value the alert SHALL say that sign-in
could not be completed and ask the visitor to try again. The page MUST NOT display the raw `error`
or `error_description` values, and SHALL NOT show either alert to a signed-in visitor.

#### Scenario: Invalid-link error shown to a signed-out visitor

- **WHEN** a signed-out visitor opens `/auth/sign-in?error=invalid-link`
- **THEN** an alert explains that the link is invalid, expired, or already used
- **AND** the email form is shown so a new link can be requested

#### Scenario: Reused link from the provider is explained

- **WHEN** a visitor opens a magic link whose token was already consumed
- **THEN** the browser lands on `/auth/sign-in` with `error` set to `INVALID_TOKEN`
- **AND** the invalid, expired, or already-used alert is shown with the email form

#### Scenario: Unknown error value shows a generic alert

- **WHEN** a signed-out visitor opens `/auth/sign-in` with an `error` value such as `failed_to_create_session`
- **THEN** a generic sign-in failure alert is shown without echoing the error value
