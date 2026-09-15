# ADR-0005: Use route-specific CSP rendering modes

- Status: accepted
- Date: 2026-09-15

## Context

Next.js can attach request nonces only while dynamically rendering. Public catalog pages benefit
from static generation, while Studio handles private content and benefits from a strict nonce CSP.

## Decision

Use a static-compatible CSP for public, prerendered routes and a nonce-based `strict-dynamic` CSP for
Studio. Every route tree assigned nonce mode must call Next.js `connection()` in its layout. Test CSP
against `next build` plus `next start`, and fail E2E tests on browser console or page errors.

## Consequences

- Public pages retain SSG/CDN performance but allow framework-generated inline scripts.
- Sensitive dynamic pages pay the SSR cost for a stricter policy.
- Adding a protected route requires updating both CSP routing and its dynamic layout.

## Revisit when

- Next.js static CSP/SRI support is stable enough to remove inline script allowances.
- Studio moves to a separate origin with an independent policy.
