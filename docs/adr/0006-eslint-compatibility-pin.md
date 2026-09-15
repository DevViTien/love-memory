# ADR-0006: Temporarily pin ESLint 9

- Status: accepted with expiry condition
- Date: 2026-09-15

## Context

ESLint 10 is current, but transitive plugins in the selected Next.js 16.3.5 ESLint configuration do
not yet declare compatible peer ranges. Disabling strict peer checks would make every dependency
installation less trustworthy.

## Decision

Keep strict peer dependency enforcement and pin ESLint 9.39.5 as a narrow compatibility exception.
Dependabot monitors both npm and GitHub Actions dependencies.

## Consequences

- Installs remain deterministic without globally suppressing peer errors.
- The lint major is behind current ESLint while Next.js plugin compatibility catches up.
- Security audit, typed linting and zero-warning enforcement remain mandatory.

## Expiry condition

Upgrade to ESLint 10 and remove this ADR as soon as every Next.js lint plugin declares support and a
full lint/type/test/build/E2E run passes with strict peer dependencies enabled.
