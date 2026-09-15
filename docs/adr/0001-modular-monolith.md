# ADR-0001: Start with a modular monolith

- Status: accepted
- Date: 2026-09-15

## Context

LoveMemory needs SEO pages, an interactive Studio, a lightweight Viewer, media processing and versioned template artifacts. The initial team and product scope do not justify distributed domain services.

## Decision

Use a Next.js modular monolith for synchronous web behavior. Keep domain packages framework-independent, use object storage for binary data, and use a managed job runner for asynchronous work. Build templates as versioned artifacts behind a runtime contract.

## Consequences

- One deployment and one language reduce coordination cost.
- Module boundaries remain testable and can later be extracted.
- Long jobs must not execute in request handlers.
- Database access must stay behind repositories to prevent feature coupling.
- Template artifacts need a separate lifecycle even while the product is a monolith.

## Revisit when

- Independent teams own independently scaling domains.
- Partner API traffic dominates web traffic.
- Media processing economics justify dedicated workers.
- Commerce/reporting requirements justify a separate relational subsystem.
