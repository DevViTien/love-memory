# LoveMemory

LoveMemory is a browser-first platform for creating private, interactive memory gifts.

This repository currently implements the engineering foundation:

- Next.js App Router web application.
- TypeScript-strict pnpm/Turborepo monorepo.
- Shared contracts, constants and domain packages.
- Versioned template manifest/runtime contract.
- MongoDB connection package with lazy pooled connections.
- Private Vercel Blob direct-upload boundary and Sharp image-processing spike.
- Sandboxed template artifact/message protocol and audio fallback harness.
- Reusable UI primitives.
- Feature-oriented web modules.
- ESLint, Prettier, Vitest, Testing Library and Playwright.
- CI quality and browser-test workflows.
- Route-specific CSP verified against a production build.
- Type-aware linting and enforced dependency boundaries.

Product direction and delivery details live in:

- [idea.md](./idea.md)
- [tech-stack.md](./tech-stack.md)
- [plan.md](./plan.md)
- [Architecture](./docs/architecture.md)

## Requirements

- Node.js 24 LTS is recommended. Node.js 22.13+ can run the current toolchain.
- pnpm 10.22.0.
- MongoDB is optional for the initial catalog page and required for persistence work.

## Getting started

```bash
pnpm install
pnpm exec playwright install chromium
pnpm dev
```

Open http://localhost:3000.

To configure the application, copy **.env.example** to **apps/web/.env.local**. MongoDB is enough
for the catalog/readiness foundation. The protected Sprint 0 upload lab additionally requires
Vercel Blob and the `TECHNICAL_SPIKE_*` values described in
[the Vercel Blob setup guide](./docs/runbooks/vercel-blob-setup.md).

## Quality commands

| Command            | Purpose                                     |
| ------------------ | ------------------------------------------- |
| pnpm format:check  | Verify formatting                           |
| pnpm lint          | Run ESLint with zero warnings               |
| pnpm type-check    | Type-check root tooling and every workspace |
| pnpm test          | Run unit and component tests                |
| pnpm test:coverage | Run coverage gates                          |
| pnpm test:e2e      | Build and test production UI                |
| pnpm build         | Build production artifacts                  |

## Repository structure

```text
apps/web                 Next.js app and feature modules
packages/contracts       Runtime-validated API contracts
packages/database        MongoDB infrastructure
packages/domain          Framework-independent business rules
packages/media           Provider-neutral image processing
packages/shared          Truly cross-cutting primitives/constants
packages/storage         Private Vercel Blob object-storage adapter
packages/template-sdk    Versioned template manifest/runtime contract
packages/ui              Reusable React UI primitives
templates                Independently built template workspaces
docs/                    Architecture and ADRs
test/                    Shared test setup
```

Packages expose a small public API through their index file. Application modules follow domain/application/infrastructure/presentation boundaries where those boundaries add value.

## Current scope

The scaffold intentionally does not pretend the 16-week MVP is finished. Authentication, uploads, persistence, payment and the three production templates are implemented in subsequent vertical slices defined in [plan.md](./plan.md).
