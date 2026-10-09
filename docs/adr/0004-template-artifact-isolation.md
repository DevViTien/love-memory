# ADR-0004: Isolate immutable template artifacts

- Status: accepted
- Date: 2026-09-15

## Context

Templates execute animation code against private user content. A template update must not break an
already published gift or gain arbitrary access to application state and network APIs.

## Decision

Build templates as immutable, content-addressed artifacts behind the versioned Template SDK.
Validate manifests and build budgets in CI. The Viewer will execute artifacts in a sandboxed iframe
through a schema-validated message protocol and an allowlisted asset resolver.

## Consequences

- Published gifts reference an exact template and engine version.
- Template capabilities and network access are denied unless explicitly declared and enforced.
- SDK compatibility, reduced-motion behavior and visual fixtures become release gates.
- **Kill switch** (`add-template-kill-switch`, 2026-10-10). An admin can kill a template version
  that misbehaves. The version stays pinned and its manifest unchanged, but no consumer receives its
  artifact any more: viewers show the static rendering, publishing is refused, and the artifact
  route answers `404`. A restore brings the same immutable artifact back. Gifts never move to
  another version.

## Revisit when

- Browser isolation proves insufficient for a supported template capability.
- Artifact volume justifies a separate registry service.
