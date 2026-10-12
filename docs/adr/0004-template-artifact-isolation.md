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
- **HTML templates** (`add-html-template-kind`, 2026-10-13). A second kind, `html`, is imported as
  data instead of built in the repository. Its artifact is content-addressed over all of its files
  and stored in object storage; the importer refuses external URLs, inline handlers and navigation,
  and moves inline scripts into files run by the `LoveGift` bootstrap. The isolation stays the
  same iframe sandbox and protocol. The template CSP allows fonts and images only from
  `/template-artifacts/`, and artifact responses carry `sandbox allow-scripts`, so a directly
  opened artifact also runs in an opaque origin. The gift viewer treats a second load of the frame
  as a navigation: it never posts to that window again and shows the static rendering. The
  importer's checks are a lint and a defence in depth, not the trust boundary. The boundary is the
  sandbox, the CSP, the host's checks and the operator's review of imported HTML. The manifest
  validation and budgets of CI apply to `sdk` workspaces; `html` versions are checked by the
  importer.

## Revisit when

- Browser isolation proves insufficient for a supported template capability.
- Artifact volume justifies a separate registry service.
