# Architecture

## Shape

LoveMemory starts as a modular monolith with separately versioned template artifacts.

```text
Browser
├── Marketing and catalog
├── Studio
└── Viewer shell
    └── Sandboxed template runtime

Next.js web/BFF
├── Feature modules
├── Application services
└── Data access layer

Managed infrastructure
├── MongoDB Atlas for operational documents
├── Private Vercel Blob for user media and derivatives
└── Background jobs for processing and reliable side effects
```

## Dependency direction

```text
presentation → application → domain
                         ↘ ports ← infrastructure
```

- Domain packages have no framework/provider dependency.
- Application services coordinate behavior through ports.
- Infrastructure implements ports with MongoDB, storage, email or payment providers.
- Presentation maps HTTP/UI concerns to application inputs and outputs.

## Package ownership

### shared

Only concepts shared by most packages belong here: app identity, HTTP-neutral result primitives and small safe utilities. Feature-specific constants stay with their feature.

### contracts

External API request/response schemas. Contracts are validated at runtime and imported by both server and clients.

### domain

Business state and invariants such as gift transitions. It cannot import React, Next.js, MongoDB or provider SDKs.

### template-sdk

The stable boundary between Studio, Viewer and template artifacts. A published artifact is immutable.

### database

MongoDB connection and collection naming. Repositories belong to feature infrastructure, not this generic package.

### ui

Accessible, reusable primitives. Product-specific composition stays in app feature modules.

## Boundary rules

1. Validate untrusted data at entry.
2. Authorize close to data access.
3. Return DTOs, never raw database documents.
4. Store binary objects outside MongoDB.
5. Put long-running/retryable work in background jobs.
6. Keep protected gift payloads out of public caches.
7. Keep template dependencies out of the Viewer shell.
8. Make publish and payment workflows idempotent.

These rules are enforced by type-aware ESLint import restrictions, per-runtime TypeScript configs,
runtime schemas and tests. Composition roots under `apps/*/src/composition` are the only place where
application services are wired to concrete infrastructure adapters.

## Rendering and CSP

Public catalog routes remain statically rendered and use a static-compatible CSP. Studio routes are
dynamically rendered and receive a per-request nonce. A route must never use nonce CSP unless its
layout explicitly opts into dynamic rendering. Production Playwright tests verify both modes.

## Configuration

Each infrastructure boundary owns and validates its environment variables. Server-only URLs use
`APP_URL` and `ASSET_ORIGIN`; they are not exposed with a `NEXT_PUBLIC_` prefix. Invalid configured
values fail at the boundary instead of silently falling back to production localhost values.

## Why no service layer per entity?

Layers are used around business behavior, not mechanically for every file. A simple read-only catalog can be an application function plus repository interface. A publish flow earns a richer use-case, transaction boundary and outbox.
