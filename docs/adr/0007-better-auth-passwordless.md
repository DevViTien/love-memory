# ADR-0007: Use Better Auth for creator identity

- Status: accepted for Sprint 1
- Date: 2026-09-15

## Context

Creators need lightweight passwordless identity, while gift recipients must not need an account.
The application also needs explicit server-side session and ownership checks without inventing a
custom authentication protocol.

## Decision

Use Better Auth with its MongoDB adapter and email-based passwordless flow. Keep session access
behind a small DAL (`verifySession`, `getCurrentUser`) and authorization inside application use
cases. Anonymous drafts use a separate random claim token and are attached to an authenticated
owner only after verification.

## Consequences

- Auth routes, cookie policy, trusted origins and email delivery require integration tests.
- Magic-link/OTP values are hashed at rest and never logged.
- Admin identity requires a distinct role and MFA before admin features become active.
- Auth types must not leak into the gift domain package.

## Revisit when

- Delivery reliability or account-linking requirements exceed the selected provider/plugin.
- Enterprise identity becomes a product requirement.
