# Sprint 2 — Media pipeline and Viewer runtime

## Delivered

- Gift-bound private image upload with short-lived Vercel Blob PUT grants, manifest quotas, MIME/size verification, anonymous/user authorization, and safe browser DTOs.
- MongoDB asset state machine, atomic quota-slot reservation, and durable outbox with transactional enqueue, bounded retry, stale-job recovery, and abandoned-upload cleanup.
- Trigger.dev drain and five-minute sweep tasks; deployed requests only dispatch durable work and never depend on the request lifecycle to finish Sharp processing.
- Sharp worker producing responsive WebP derivatives, stripped metadata, placeholder, dimensions, and SHA-256 checksum.
- Studio multi-image picker with client-side aspect-ratio crop, upload progress, cancel/delete, transient-only retry, reorder, reload recovery, and blocking status while media is not ready.
- Immutable, content-addressed ESM template artifacts with SHA-256 ETags and generated build metadata.
- Sandboxed Viewer shell with validated messages, lifecycle controls, asset URL allowlist injection, visibility pause, reduced-motion switch, user-gesture audio, viewport harness, event log, and network-denying artifact CSP.

## Security invariants

- Gift documents contain asset IDs only; source/derivative keys remain server-side.
- Every saved media reference is a unique UUID validated against the same gift, field, and an allowed asset state.
- Blob storage remains private and download URLs are short-lived.
- SVG and arbitrary MIME types are rejected before upload; decoded MIME is checked again in the worker.
- The template iframe has an opaque origin (`sandbox="allow-scripts"`), cannot read the host session/storage, and has `connect-src 'none'`.
- Host accepts runtime events only from the exact iframe window and validates their schema.

## Verification

- Unit/integration tests cover domain transitions, contracts, processing, worker failure/retry, Mongo transaction/outbox behavior, routes, CSP, artifact identity, and bridge lifecycle.
- Playwright covers the Viewer READY → PLAY → COMPLETE → DESTROY flow and detects unexpected runtime requests.
- Atlas/Vercel Blob live smoke verification covered browser direct PUT, completion, Sharp processing, three private WebP derivatives, signed download, and fixture cleanup.
- Use `pnpm verify:local` for the full local gate when MongoDB is available.
