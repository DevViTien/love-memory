# ADR-0003: Store user media in private Vercel Blob

- Status: accepted
- Date: 2026-09-16

## Context

Photos, audio and generated derivatives are much larger than application metadata. They need
independent retention, direct browser upload and controlled delivery. Couple photos are user content
and must not become public merely because somebody obtains the underlying object URL.

## Decision

Use a **private Vercel Blob store** as the first media provider. MongoDB stores ownership, lifecycle
state, checksums and Blob pathnames, not binary bodies.

- The browser uploads through a short-lived signed `PUT` URL scoped to one random pathname, one MIME
  allowlist and a maximum byte size.
- The server performs a bounded consistent read, decodes the real image, removes metadata and writes
  a WebP derivative. The original is deleted after success or validation failure.
- Private media is delivered only after application authorization, either through a server stream or
  a short-lived signed `GET` URL. Raw private Blob URLs are never treated as authorization.
- Vercel OIDC credentials are preferred in deployments. `BLOB_READ_WRITE_TOKEN` is allowed only for
  local development and must never reach client code, logs or Git.
- Provider calls stay behind the small `ObjectStorage` boundary so domain/application code does not
  import the Vercel SDK.

Template artifacts are shipped as immutable application artifacts for the current milestone. A
separate public delivery store may be evaluated later; it must not weaken the private media store.

## Consequences

- Blob Store access mode must be chosen as private at creation time and cannot be changed later.
- Media deletion remains a workflow spanning MongoDB records, Blob objects and cached signed reads.
- Abandoned source objects require an explicit cleanup job because database TTL cannot delete Blobs.
- Signed URLs are credentials and must be redacted from telemetry.
- A real Vercel Preview is required to verify OIDC, region latency and direct browser upload.

## Revisit when

- Media delivery cost or volume requires a dedicated public derivative strategy.
- Video becomes a core format and needs a specialized transcoding/CDN provider.
- Legal or data-residency requirements cannot be met by the selected Blob region.
