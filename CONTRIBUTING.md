# Contributing

## Local workflow

1. Copy **.env.example** to **apps/web/.env.local** and set local values.
2. Install with **pnpm install**.
3. Start the web app with **pnpm dev**.
4. Before opening a pull request, run the quality commands from README.

## Architecture rules

- Domain code must not import Next.js, MongoDB, React or provider SDKs.
- UI and route handlers call application services; they do not query collections directly.
- Validate every external boundary at runtime.
- Keep business constants in their owning package; do not create a global dumping-ground file.
- Export public package APIs from **src/index.ts**; do not deep-import package internals.
- Prefer named exports.
- Application modules depend on ports. Wire concrete adapters only in a composition root.
- Declare dependencies only when production code uses them; do not preinstall a future stack.
- A nonce-CSP route must be dynamically rendered and covered by a production browser test.
- A template release is immutable after a gift references it.
- Never store image/audio bytes or base64 payloads in MongoDB.
- Never log gift text, access passwords, magic-link tokens or signed URLs.
- Technical-spike endpoints remain disabled unless a preview/local-only bearer token is configured.

## Tests

Vitest provides the Jest-compatible unit/component test API. Playwright covers browser journeys.

- Put a test next to the behavior it verifies.
- Test domain invariants and public behavior, not private implementation details.
- New template fields require schema tests.
- New gift states require transition tests.
- Security or payment fixes require a regression test.
- Unit coverage includes untested domain, application, infrastructure, security and non-React
  presentation modules, and must satisfy aggregate and per-file gates. Next.js entrypoint wiring and
  React page composition are verified by production-build Playwright journeys instead of being
  hidden inside the unit-coverage percentage.

## Pull requests

- Keep changes focused and reviewable.
- Explain the user-facing outcome and risks.
- Include screenshots for visual changes.
- Update an ADR when reversing a recorded architectural decision.
- Do not merge with failing checks or unexplained lint suppressions.
- Review browser console/page errors from a production build, not only `next dev`.
