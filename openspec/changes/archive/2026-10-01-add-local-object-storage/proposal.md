# Proposal

## Why

Gate M2 (plan.md §12.7) needs an automated E2E journey create → upload → customize → preview →
publish → open. Today `packages/storage` has only a Vercel Blob adapter, and neither local
development nor the CI `e2e` job has Blob credentials. The upload step therefore cannot run in
Playwright, and a developer without a pulled Vercel environment cannot upload a photo at all.

This change adds a filesystem-backed `ObjectStorage` adapter for development and Playwright only.
It keeps the same grant, signed-URL and size/content-type rules as Blob, so the rest of the media
pipeline runs unchanged, and it refuses to start on any Vercel deployment.

## What Changes

- Add `STORAGE_DRIVER` (`vercel-blob` by default, or `local`). `local` needs a signing secret
  `LOCAL_OBJECT_STORAGE_SECRET` (at least 32 characters) and `APP_URL`, and stores objects under
  `<workspace root>/.tmp/object-storage/` (already git-ignored).
- Refuse `local` whenever `VERCEL_ENV` is set to anything other than `development`, so
  `production`, `preview` and any custom Vercel environment always fail closed: storage cannot be
  constructed, media routes answer `500` `INTERNAL_ERROR`, readiness answers `503`, and the local
  object routes stay `404`.
- Add same-origin route handlers `PUT` and `GET` `/api/local-object-storage/{key}` that accept only
  HMAC-SHA256-signed, expiring URLs:
  - `PUT` enforces the grant's single key, exact content type, maximum size and no-overwrite rule;
  - `GET` serves the stored bytes with `Cache-Control: private, no-store`, `nosniff` and a
    sandboxing CSP;
  - both reject path traversal and malformed keys, and answer `404` when the local driver is off;
  - `POST`, `PATCH` and `DELETE` answer `405`, and `HEAD` is never granted.
- Keep signed URLs out of logs: the routes log only a fixed operation name, a request id and an
  error name, and `next.config.ts` makes the development incoming-request log ignore
  `/api/local-object-storage/`.
- Keep the upload grant, completion and processing contracts unchanged. Grant and download URLs
  become absolute `APP_URL`-origin URLs in local mode, so existing Zod contracts (`z.url()`) and the
  template `INIT.assets` schema accept them.
- CSP: in local mode, add the local storage origin (the `APP_URL` origin) to the application media
  sources, and the local object route source (`<APP_URL origin>/api/local-object-storage/`) to the
  template document `img-src`, so the Studio can upload and templates can show signed images. In local mode, template artifact responses are sent `no-store` instead of
  `immutable`, because their CSP then depends on the environment.
- Readiness: validate the configuration of the selected driver instead of always requiring Blob
  credentials, and refuse the `local` driver together with the `trigger` worker mode, because
  Trigger.dev workers cannot read the local disk.
- Playwright's web server runs with `STORAGE_DRIVER=local`, `APP_URL` equal to its base URL and a
  fixed test secret. A new E2E opens `/studio/{publicId}?field=memories` on a seeded
  `memory-box@1.1.0` draft, uploads a real image through the Studio image field and waits until it
  is `ready`.
- Document the driver in the media pipeline runbook, `.env.example`, `docs/architecture.md` and a
  "Development and test storage" note in ADR-0003.

This change belongs to **Sprint 3, Gate M2**. It is the third of the Sprint 3 changes, in this
order:

1. `add-memory-box-template`
2. `add-schema-driven-studio`
3. `add-local-object-storage` (this change)
4. `add-gift-preview`
5. `add-temporary-gift-publish`
6. `add-funnel-analytics`

**Dependencies:** the E2E needs `add-memory-box-template` (the seeded `memory-box@1.1.0` with the
`memories` field) and `add-schema-driven-studio` (the `?field=` deep link and the
`studio-field-{fieldId}` control ids). Both are earlier in the order above. Everything else in this
change is independent of them.

## Non-goals

- Using local storage on any Vercel environment (Production, Preview or a custom environment), or
  on any shared or long-lived deployment. It is a single-machine development and E2E tool.
- Serving published gifts from local storage in production, or any durability, backup, quota or
  multi-instance guarantee for local files.
- Running Trigger.dev tasks (deployed or `pnpm jobs:dev`) against local storage. Local mode
  supports the `inline` worker and `pnpm media:work` only.
- Changing the Vercel Blob adapter, its credentials or the upload/processing contracts in
  `media-upload` and `media-processing`.
- HTTP range requests, `HEAD` downloads, CDN caching or audio delivery through local storage.
- Automatic cleanup of `.tmp/object-storage/`; the existing abandoned-upload and delete flows remove
  objects through the adapter as they do on Blob.
- The full Gate M2 journey E2E (preview, publish, open). It belongs to `add-funnel-analytics`.

## Capabilities

### New Capabilities

- `local-object-storage`: the development/E2E filesystem object store, covering:
  - driver selection and the fail-closed refusal on Vercel;
  - the signed `PUT` upload route with its key, content-type, size, expiry and no-overwrite rules;
  - the signed `GET` download route and its response headers;
  - key validation and path traversal protection;
  - parity of the adapter with the Blob adapter's observable storage contract.

### Modified Capabilities

- `content-security-policy`:
  - "Isolated template document policy": `img-src` also lists the local object route source in
    local mode;
  - "Asset and upload origins": the application media sources also list the local storage origin
    in local mode.
- `template-artifact-delivery`:
  - "Immutable caching and integrity headers": artifact responses are `no-store` in local mode;
  - "Network-denying artifact CSP": `img-src` also lists the local object route source in local
    mode.
- `health-checks`:
  - "Readiness dependency checks": storage configuration is validated for the selected driver, and
    the `local` driver is refused on Vercel and together with the `trigger` worker mode.

`media-upload` is not modified: the grant still carries `method` `PUT`, a presigned `url`,
`headers` and `expiresAt` with the same scope and TTL. Only the host of the URL differs, and the
local route's rules are specified in `local-object-storage`.

## Impact

- **Invariants touched**:
  - _Validate untrusted input at every entry_: the local routes validate the key, the signature,
    the expiry, the content type and the size before touching the filesystem.
  - _Storage keys and raw Blob URLs never reach the browser_: in local mode the browser receives
    only signed, expiring URLs, exactly like Blob presigned URLs. The key is part of the URL path
    just as the Blob pathname is today. No unsigned URL can read an object.
  - _Blob storage is private; downloads use short-lived signed URLs_: local objects are readable
    only through `GET` URLs signed after authorization, with the same 300-second default TTL.
  - _Never store image/audio bytes in MongoDB_: bytes go to the local disk; MongoDB still stores
    only keys and metadata.
  - _Long-running work goes through the outbox and background jobs_: unchanged; the inline worker
    and `pnpm media:work` read and write through the same adapter.
  - _Protected gift payloads never enter public caches_: local `GET` responses are
    `private, no-store`.
  - _Template code has no network access_: the template `img-src` gains only the local object
    route of the configured app origin, and only in local mode; `connect-src` stays `'none'`.
  - _Never log signed URLs_: the local routes log only a fixed operation name, the request id and
    an error name, and the development incoming-request log ignores `/api/local-object-storage/`.
- **Code**:
  - `packages/storage`: a driver-aware configuration parser, the filesystem adapter, the URL
    signer/verifier and key validation, with tests.
  - `apps/web/src/composition/media.ts`: construct the adapter from the configuration.
  - `apps/web/src/app/api/local-object-storage/[...key]/route.ts` plus its presentation handler and
    tests.
  - `apps/web/src/security/content-security-policy.ts`, `apps/web/src/proxy.ts`, the
    `template-artifacts` route: pass the local storage origin; the artifact route switches to
    `no-store` in local mode.
  - `apps/web/next.config.ts`: `logging.incomingRequests.ignore` for the local object routes
    (additive; `add-memory-box-template` also edits this file).
  - `apps/web/src/app/api/health/ready/route.ts` and `media-job-scheduler.ts` readiness checks.
  - `playwright.config.ts`, a new `apps/web/e2e/media-upload.spec.ts` and an image fixture.
- **Docs**: `docs/runbooks/media-pipeline.md`, `docs/adr/0003-object-storage-for-media.md`,
  `docs/architecture.md`, `.env.example`.
- **APIs**: new `PUT`/`GET` `/api/local-object-storage/{key}`, answering `404` unless the local
  driver is active. No change to existing routes or DTO shapes.
- **Data**: no collection, validator, index or migration change. `DATABASE_SCHEMA_VERSION` is not
  changed by this change.
- **Dependencies**: none added (Node `crypto`, `fs` and `path` only).
