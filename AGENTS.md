# AGENTS.md — LoveMemory

Instructions for AI coding agents (Claude Code, Codex, Cursor, …) working in this repository.
Human contributors follow the same rules; see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Project

LoveMemory lets a creator turn photos, messages, a date and licensed music into a private,
interactive "memory gift". The recipient opens it by link or QR on a phone, with no account and no
app. Primary market: Vietnam — user-facing copy is Vietnamese; code, specs and engineering docs are
English.

- Stack: TypeScript strict · pnpm 10 + Turborepo · Next.js 16 App Router · React 19 · Tailwind 4 ·
  MongoDB (official driver, Zod at boundaries) · Better Auth magic link + Resend · private Vercel
  Blob · Sharp · Trigger.dev · Vitest · Playwright · Vercel.
- Status: Sprints 0–2 shipped (foundation, auth + gift drafts, media pipeline + Viewer runtime).
  Next: Sprint 3 vertical slice, Gate M2 in [plan.md](./plan.md).

## Sources of truth

| Question                         | Where                                                       |
| -------------------------------- | ----------------------------------------------------------- |
| What does the system do today?   | `openspec/specs/` (behavior, one capability per folder)     |
| What is being changed right now? | `openspec/changes/` (`pnpm openspec list`)                  |
| How is it designed, and why?     | [docs/architecture.md](./docs/architecture.md), `docs/adr/` |
| How do I operate it?             | `docs/runbooks/`                                            |
| What comes next, in which order? | [plan.md](./plan.md) (sprints, gates M0–M6)                 |
| Why does the product exist?      | [idea.md](./idea.md), [tech-stack.md](./tech-stack.md)      |

Read the relevant spec before touching a capability. If code and spec disagree, the spec is wrong
or the code is buggy — resolve it explicitly, never leave them diverged.

## Workflow: OpenSpec (spec-driven)

### When a change is required

Adding, changing or removing **behavior** (a requirement or scenario a user, API client or template
could observe) goes through OpenSpec:

1. `/opsx:explore` (optional) — think through the problem; no code.
2. `/opsx:propose <description>` — creates `openspec/changes/<name>/` with `proposal.md`,
   delta `specs/`, `design.md`, `tasks.md`. Review it before implementing.
3. `/opsx:apply <name>` — implement task by task, checking boxes as each is verified.
4. `/opsx:archive <name>` — merge the delta into `openspec/specs/` **in the same PR** that
   completes the change.

Bug fixes, refactors, tooling and infrastructure that keep behavior identical do not need a change.
If a fix reveals that the spec was wrong, correct the spec in the same PR.

### Sizing

One change = one reviewable outcome, usually one sprint story from plan.md (e.g. Sprint 3 splits
into schema-driven Studio, preview, template "Hộp ký ức", temporary publish). Name changes
`add-…`, `change-…`, `remove-…`, `fix-…` in kebab-case.

### Definition of done

- Every task in `tasks.md` is checked only when it is actually done and verified. Intentionally
  deferred work goes under `## Out of scope`, never as an unchecked box.
- `pnpm verify:local` passes (includes `pnpm spec:check`).
- The change is archived in the same PR. `pnpm spec:check` fails if a fully checked change is left
  unarchived, or if a `## MODIFIED Requirements` block drops a backticked identifier that the
  current spec contains (OpenSpec itself only compares scenario names).
- A blocked archive or an intentional identifier removal is declared in
  `openspec/gate-exceptions.json` with owner, reason and expiry. Never uncheck tasks to turn the
  gate green.
- Archive in proposal creation order. When a requirement changes its nature, use REMOVED + ADDED
  with a different name; before renaming a requirement, grep `openspec/changes/*/specs/**` for the
  old name.

### CLI

The CLI is pinned in package.json; run it as `pnpm openspec <command>` (the `/opsx:*` skills say
`openspec …` — use the pnpm form, or install the same version globally with
`npm i -g @fission-ai/openspec@1.13.2`). Useful: `pnpm openspec list`, `pnpm openspec show <name>`,
`pnpm openspec validate --all --strict`, `pnpm spec:check`.

## Commands

```bash
pnpm install                  # Node 24 LTS recommended (22.13+ works), pnpm 10.22.0
pnpm dev                      # http://localhost:3000; needs MongoDB (replica set) + root .env
pnpm test                     # Vitest unit/component
pnpm test:e2e                 # Playwright against a production build
pnpm db:seed && pnpm db:verify
pnpm spec:check               # OpenSpec validation + process gates
pnpm verify:local             # full pre-push gate (secrets, specs, format, lint, types,
                              # coverage, audit, build, installed-Chrome E2E)
```

## Architecture rules

- `presentation → application → domain`; infrastructure implements application ports and is wired
  only in `apps/web/src/composition`. ESLint enforces the domain and application boundaries.
- `packages/domain` never imports React, Next.js, MongoDB or provider SDKs.
- Route handlers and UI call application services; they never query collections directly.
- Validate every external boundary at runtime (Zod contracts in `packages/contracts`).
- Import packages through their `src/index.ts`; no deep imports. Prefer named exports.
- Keep constants in their owning package; no global constants file.
- Add a dependency only when production code uses it.

## Invariants (never violate)

- Authorize inside the data-access filter; non-owners get an opaque 404.
- Return DTOs, never raw documents. Gifts reference media by asset ID only; storage keys and raw
  Blob URLs never reach the browser; downloads use short-lived signed URLs.
- No image/audio bytes or base64 in MongoDB.
- Long-running or retryable work goes through the outbox and background jobs, never a request.
- A template release is immutable once referenced; published gifts pin an exact template version.
  Template code runs in `sandbox="allow-scripts"` without network access; the host accepts only
  schema-valid messages from that exact iframe.
- Public routes use static-compatible CSP; private-content routes use nonce CSP and must call
  `connection()` in their layout. Protected gift payloads never enter public caches.
- Publish and payment are idempotent; only a verified webhook or reconciliation marks an order paid.
- Never log gift text, access passwords, magic-link tokens or signed URLs. Never commit `.env*`.
- Recipients need no account; audio starts only from a user gesture; reduced-motion and no-audio
  paths always exist.

## Next.js 16

This Next.js version has breaking changes from older releases (for example `proxy.ts` replaces
middleware). Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code,
and heed deprecation notices. See [apps/web/AGENTS.md](./apps/web/AGENTS.md).

## Tests

- Tests live next to the behavior they verify. Test public behavior and invariants.
- New gift states need transition tests; new template fields need schema tests; security and
  payment fixes need a regression test.
- Per-file and aggregate coverage gates apply (see `vitest.config.ts`). React page composition is
  covered by Playwright production-build journeys.

## Git

- Branch from `dev` as `feature/<name>`, `fix/<name>` or `chore/<name>`; promote `dev → stg → main`
  only (see [the deployment runbook](./docs/runbooks/preview-deploy-and-rollback.md)). Never run
  ad-hoc `vercel deploy`.
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- Commit or push only when asked.
