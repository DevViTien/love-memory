# ADR-0002: Use MongoDB with the official Node.js driver

- Status: accepted
- Date: 2026-09-15

## Context

Gift content is naturally document-shaped and varies by immutable template version. The team still
needs explicit invariants, controlled queries and predictable connection behavior.

## Decision

Use MongoDB Atlas with the official Node.js driver. Validate boundaries with Zod and keep collection
access behind feature-owned repositories. Reuse one recoverable `MongoClient` connection pool per
process. Store indexes and data migrations as reviewed code.

## Consequences

- No ODM lifecycle hooks or implicit query behavior.
- Repositories must map database documents to domain objects and DTOs.
- Initial connection failures must clear the cached promise so a process can recover.
- Binary media remains outside MongoDB.

## Revisit when

- Relational reporting or transactional workloads dominate the document workload.
- A second application language needs a database contract independent of TypeScript.
