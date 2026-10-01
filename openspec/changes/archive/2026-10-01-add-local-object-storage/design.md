# Design

## Context

See proposal.md for why this change exists. Today:

- `packages/storage/src/object-storage.ts` defines the `ObjectStorage` port (`createUpload`,
  `createDownloadUrl`, `getObject`, `getObjectMetadata`, `putObject`, `deleteObject`), the errors
  `ObjectNotFoundError`, `InvalidStoredObjectError` and `StoredObjectTooLargeError`, and the only
  adapter, `createVercelBlobObjectStorage`. `environment.ts` parses Blob credentials only.
- `apps/web/src/composition/media.ts` builds one adapter per service (`createStorage()`) for the
  media service, the media worker and the spike service. The worker also runs from
  `scripts/media-worker.ts` (`pnpm media:work`, cwd = repository root) and from the Trigger.dev
  tasks in `apps/web/src/trigger/media-worker.ts`. The web server runs with cwd `apps/web`
  (`next-with-root-env.mjs`, which loads the root `.env` without overriding exported variables).
- Key shapes used by the application: `private/assets/{uuid}/source`,
  `private/assets/{uuid}/derivatives/w{320|768|1280}.webp`, `private/spikes/{uuid}/source`,
  `processed/spikes/{uuid}/w768.webp`.
- Contracts validate grant and derivative URLs with `z.url()` (`packages/contracts/src/media.ts`,
  `upload.ts`), and the template `INIT.assets` values with `z.url()`
  (`packages/template-sdk/src/messages.ts`). Relative URLs would fail all three.
- The Studio field uploads with `XMLHttpRequest` `PUT` to the grant `url`, sets every grant header
  and treats any `2xx` as success (`media-image-list-field.tsx`).
- CSP (`apps/web/src/security/content-security-policy.ts`): application pages already allow
  `'self'` in `connect-src`, `img-src` and `media-src`; the template document `img-src` is
  `data: https://*.private.blob.vercel-storage.com [ASSET_ORIGIN]`. The proxy matcher skips `/api`,
  and `template-artifacts` responses set their own template policy.
- `/api/health/ready` calls `getStorageEnvironment()` (Blob only) and `assertMediaRuntimeReady`.
- `playwright.config.ts` starts `next start` (so `NODE_ENV=production`) with
  `MEDIA_WORKER_MODE=inline` and no storage configuration; CI's `e2e` job has no Blob secrets.
- `.gitignore` already ignores `.tmp/`.

Governing ADRs:

- ADR-0003 (private Vercel Blob for media). Deployments keep Blob. This change adds a development
  and test adapter behind the existing `ObjectStorage` boundary that the ADR requires, with the same
  signed-URL, scope and privacy rules. It does not contradict the ADR; task 6.2 records it there.
- ADR-0005 (route-specific CSP). The new routes are API routes outside the proxy matcher and carry
  their own restrictive headers.
- ADR-0004 (template isolation). The template `img-src` gains one path-scoped source (the local
  object route) only in local mode; `connect-src` stays `'none'`.
- ADR-0008 (Trigger.dev). Trigger.dev workers do not share the developer's disk, so local mode is
  limited to the inline worker.

## Goals / Non-Goals

**Goals:**

- The real upload → complete → process → signed-read path runs in Playwright and in plain local
  development without any provider credential.
- Local mode behaves like Blob wherever the application can observe it (grant shape, TTLs, size
  and type scoping, no-overwrite, not-found and too-large errors), so no application code branches
  on the driver.
- Misconfiguration fails closed on Vercel and is visible in readiness.

**Non-Goals:**

- Performance, concurrency across several server processes, or crash durability of local files.
- A generic storage plug-in system; there are exactly two drivers.

## Decisions

### D1. Configuration contract in `packages/storage`

`environment.ts` gains a driver-aware parser. It replaces `getStorageEnvironment()` as the entry
point used by composition and readiness; the Blob credential schema is reused unchanged.

```ts
type StorageConfiguration =
  | { driver: "vercel-blob"; credentials: StorageEnvironment }
  | { driver: "local"; rootDirectory: string; publicOrigin: string; signingSecret: string };

parseStorageConfiguration(source, { workspaceRoot }): StorageConfiguration; // pure, throws
// workspaceRoot: string | (() => string); a resolver is called only for the local driver
getStorageConfiguration(): StorageConfiguration; // process.env + () => findWorkspaceRoot(process.cwd())
getLocalObjectStorageOrigin(source): string | undefined; // never throws, no fs access; for CSP
```

- `STORAGE_DRIVER`: `vercel-blob` | `local`; empty or unset means `vercel-blob`.
- `local` requires:
  - `LOCAL_OBJECT_STORAGE_SECRET`, 32–256 characters. It is a dedicated variable. Reusing
    `BETTER_AUTH_SECRET` would couple two unrelated keys. A random per-process secret would break
    URLs across restarts and between the Studio page render and the route handler in `next dev`.
  - `APP_URL`, whose origin becomes `publicOrigin`.
- `VERCEL_ENV` refusal: `local` is allowed only when `VERCEL_ENV` is unset, empty or `development`.
  This is stricter than "not production/preview" on purpose: Vercel custom environments and any
  future value also fail closed. `NODE_ENV` is not consulted, because Playwright and CI run
  `next start`.
- `rootDirectory` = `<workspace root>/.tmp/object-storage`. The workspace root is the nearest
  ancestor of `process.cwd()` that contains `pnpm-workspace.yaml`. If none is found, that is a
  configuration error. This makes the web server (cwd `apps/web`) and `pnpm media:work` (cwd root)
  share one directory without another variable. There is no root override variable (fewer knobs);
  unit tests inject `rootDirectory` into the adapter factory directly. The root is resolved lazily
  and only for the `local` driver, so the Blob path (every deployment, whose bundle may not contain
  `pnpm-workspace.yaml`) never walks the filesystem.
- `getLocalObjectStorageOrigin(source)` derives the origin from the environment only: it returns
  the `APP_URL` origin when `STORAGE_DRIVER` is `local`, `VERCEL_ENV` is allowed, the secret has a
  valid length and `APP_URL` is a valid HTTP(S) URL; otherwise `undefined`. It never walks the
  filesystem for the workspace root and never touches the disk, because the proxy and the
  `template-artifacts` route call it on every request. It must never throw (same reasoning as
  `technical-spikes.ts`: a throwing proxy would take the whole site down). Both it and
  `parseStorageConfiguration` share one pure driver/refusal/secret/`APP_URL` schema, so the
  "refused local driver adds no origin" scenarios follow from the same rule as the refusal itself.
  The only condition it cannot see is a missing workspace root; in that case storage construction
  fails and readiness answers `503`, and the extra CSP origin is harmless because nothing is served.

`StorageConfigurationError` (a new named error) is thrown by `parseStorageConfiguration`.
Composition builds the adapter lazily inside `getMediaService()` / `getMediaWorker()` /
`getMediaSpikeService()`. A throw there is caught by the existing route handlers, which answer
`500` `INTERNAL_ERROR` (spikes: `503`). A failed construction is not cached, so fixing the
environment and restarting recovers.

_Alternative rejected:_ a `LOCAL_OBJECT_STORAGE_ROOT` variable. It is not needed for either use,
and a relative value would resolve differently per process cwd, which is exactly the bug the
workspace-root rule avoids.

_Alternative rejected:_ relative URLs (`/api/local-object-storage/...`), which would avoid
`APP_URL`. They fail the existing `z.url()` contracts in `packages/contracts` and the template
`INIT.assets` schema. Loosening those contracts would change the public API for every driver.

### D2. Adapter `createLocalObjectStorage({ rootDirectory, publicOrigin, signingSecret, now })`

Layout under `rootDirectory`:

- `objects/<key>`: the bytes.
- `metadata/<key>.json`: `{ contentType, contentLength, etag, createdAt }`. It is validated with
  Zod on read; a malformed file raises `InvalidStoredObjectError`.
- `incoming/<uuid>`: temporary files, always on the same volume.

Object and metadata trees are separate so that no key can collide with a sidecar name.

Operations (parity table with the Blob adapter):

| Port method         | Local behavior                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createUpload`      | Validates the key and returns `{ method: "PUT", url, headers: { "content-type" }, expiresAt }` with a signed `PUT` URL (D3).                                                                                                                                                                                        |
| `createDownloadUrl` | Returns a signed `GET` URL; default TTL `STORAGE_LIMITS.downloadUrlTtlSeconds` (300).                                                                                                                                                                                                                               |
| `getObjectMetadata` | Reads the metadata file. Missing → `ObjectNotFoundError`; malformed → `InvalidStoredObjectError`.                                                                                                                                                                                                                   |
| `getObject`         | Checks the metadata size against `maximumBytes`, then reads a bounded stream. Over the limit → `StoredObjectTooLargeError`; missing → `ObjectNotFoundError`.                                                                                                                                                        |
| `putObject`         | Writes to `incoming/`, then commits. `allowOverwrite: false` commits with an exclusive hard link (`EEXIST` → new `ObjectAlreadyExistsError`); `true` commits with a rename. Then it writes the metadata with temp + rename. `cacheControlMaxAge` is accepted and ignored, because local `GET` is always `no-store`. |
| `deleteObject`      | Removes the metadata first (the object disappears for readers), then the bytes. `ENOENT` is ignored, which makes the operation idempotent like Blob `del`.                                                                                                                                                          |

An object "exists" only when its metadata file exists. This makes the metadata write the commit
point, and a crash between the byte and metadata writes leaves an invisible orphan rather than a
half-described object. An exclusive commit that meets `EEXIST` therefore checks the metadata: only
an existing metadata file means `ObjectAlreadyExistsError`; orphaned bytes without metadata are
replaced with a rename, so an interrupted commit can never block its key with a permanent `409`. Partial `incoming/` files are removed in `finally` blocks. The adapter never
logs keys or URLs.

The filesystem adapter is server-only, like the Blob adapter, and uses `node:fs/promises`,
`node:path` and `node:crypto` only. No dependency is added.

### D3. Signed URL format and verification

```
{publicOrigin}/api/local-object-storage/{encodeURIComponent(segment)/...}
  ?expires={unixSeconds}[&contentType={type}&maxBytes={n}]&signature={base64url}
signature = base64url(HMAC-SHA256(secret,
  "lm-local-storage-v1\n" + method + "\n" + key + "\n" + expires + "\n" + (contentType ?? "") + "\n" + (maxBytes ?? "")))
```

- The method is not a query parameter. It is taken from the HTTP request, so a `GET` URL can never
  authorize a `PUT` (and vice versa) without a separate `op` check.
- Verification decodes `signature`. Anything that is not exactly 32 bytes is rejected. It then
  compares with `crypto.timingSafeEqual`. `expires` must be a positive safe integer greater than
  `now`. `maxBytes` must be a positive safe integer. `contentType` must be one of the media upload
  allowlist types (`image/jpeg`, `image/png`, `image/webp`) or the derivative type `image/webp`.
  A missing or malformed parameter gives `403 FORBIDDEN`, which is deliberately not distinguishable
  from a bad signature.
- The signer lives in `packages/storage` next to the adapter (`signLocalObjectUrl`,
  `verifyLocalObjectRequest`). The route handler calls `verifyLocalObjectRequest` and never
  re-implements the canonical string.
- The key is part of the path, as the Blob pathname is today. It is an unguessable per-asset UUID
  path, and it is never a credential. The signature is the credential.

### D4. Key validation and traversal protection

- A single `parseObjectKey(value)` is used by the adapter (every method) and by the route (after
  Next.js decodes the catch-all segments, re-joined with `/`).
- Rules (spec "Object key validation"):
  - 1–512 characters, 1–16 segments;
  - each segment 1–128 characters from `[A-Za-z0-9._-]`, not starting or ending with `.`;
  - Windows device names rejected, because developers run this on Windows.
  - This excludes `..`, `.`, empty segments, `\`, `:` and `%`.
- Defense in depth: `path.resolve(objectsDir, ...segments)` must start with `objectsDir + path.sep`.
- An invalid key in the route gives `404` before signature verification and before any `fs` call.
  An invalid key in the adapter throws a programming error.
- Keys are case-sensitive in the contract. On case-insensitive filesystems two keys differing only
  by case would collide. The application only generates lowercase UUID keys, so this is accepted
  and noted.

### D5. Route handler `apps/web/src/app/api/local-object-storage/[...key]/route.ts`

- `runtime = "nodejs"`, `dynamic = "force-dynamic"`. It exports `GET` and `PUT` only. Next.js 16
  auto-implements the rest (`next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js`):
  - `POST`, `PATCH`, `DELETE` → `405` with no body, in every mode;
  - `OPTIONS` → `204` with `Allow: GET, HEAD, OPTIONS, PUT`, in every mode, without calling our
    code;
  - `HEAD` → calls our `GET` handler with `request.method === "HEAD"`. Because the verifier binds
    the signature to `request.method` and URLs are signed only for `GET` or `PUT`, `HEAD` gives
    `404` (inactive or invalid key) or `403`, never object bytes or metadata. The server drops the
    body. The handler short-circuits `HEAD` after the signature check so no file is opened.
- The thin route delegates to
  `apps/web/src/modules/media/presentation/local-object-storage-handlers.ts` (unit-tested), which
  receives the adapter-level verifier and store through composition
  (`getLocalObjectStorageRoute()` returns `null` unless the configuration is local and allowed).
- Order of checks for both methods:
  1. driver not local → `404`;
  2. key invalid → `404`;
  3. signature, method or expiry invalid → `403`.
- Then for `PUT`:
  1. media type mismatch → `415`;
  2. `Content-Length` over `maxBytes` → `413`;
  3. an existing object → `409`;
  4. stream `request.body` into `incoming/` while counting bytes. Over the limit → abort, delete
     the partial file, `413`;
  5. commit with the exclusive link; `EEXIST` with metadata → `409` (orphaned bytes without
     metadata are replaced);
  6. write metadata `{ contentType: signed type, contentLength, etag: "sha256" }`;
  7. `204`.
- Then for `GET`: `404` without metadata, otherwise stream the file with the headers from the spec.
- Next.js route handlers read `request.body` as a stream without the proxy body limit, because the
  proxy matcher excludes `/api`. Confirm this against
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` before
  implementing.
- No mutation guards (`application/json`, same-origin, rate limit). The body is an image, the
  browser request needs no cookies, and the signature is the authorization, exactly as for a Blob
  presigned URL. Local mode is single-developer or CI only.
- Errors use the existing API error envelope with a request id. Logs go through
  `reportOperationalFailure` and carry only a fixed operation name, the request id and an error
  name. They never carry the URL, the key, the signature or the path.
- `next dev` logs every incoming request by default, which would print signed URLs.
  `apps/web/next.config.ts` therefore adds
  `logging: { incomingRequests: { ignore: [/\/api\/local-object-storage\//] } }`
  (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/logging.md`,
  "Incoming Requests"; the option only affects development). The edit is additive, because
  `add-memory-box-template` also edits `next.config.ts`. `next start` does not log incoming
  requests.

**Caching and CSP:** `GET` responses are `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`,
and `Content-Security-Policy: default-src 'none'; sandbox`. The `sandbox` directive neutralizes a
direct navigation to a stored file. The global `next.config.ts` headers already add `nosniff`,
`X-Frame-Options: DENY` and the Referrer-Policy. No `Cross-Origin-Resource-Policy` is set, because
the sandboxed (opaque-origin) template iframe must be able to load the image. Error responses are
`no-store` as well. Nothing on these routes enters a shared cache.

### D6. CSP origins

- `createContentSecurityPolicy` gains `localStorageOrigin?: string`.
- It is appended after `assetOrigin` in the application media sources, with de-duplication. The
  template `img-src` gets the path source `${origin}/api/local-object-storage/`
  (`LOCAL_OBJECT_ROUTE_PATH`) instead of the whole origin, so a template can load signed local
  objects but no other application route.
- The origin helper and the route path live in `local-object-origin.ts`, a module that imports
  only `zod` (no filesystem, crypto or Blob SDK); `@love-memory/storage` is marked
  `"sideEffects": false`, so the proxy's import of the package index bundles only that module.
- `proxy.ts` and the `template-artifacts` route pass `getLocalObjectStorageOrigin(process.env)`.
- Template artifacts are normally `public, max-age=31536000, immutable`. Their CSP now depends on
  the environment, so a browser that cached an artifact under one configuration would keep the old
  `img-src` after a switch to or from local mode. When `getLocalObjectStorageOrigin` returns an
  origin, the artifact route therefore sends `Cache-Control: no-store` (same `ETag`,
  `Access-Control-Allow-Origin` and `nosniff`). Deployments are unaffected because local mode is
  refused there. This modifies `template-artifact-delivery` ("Immutable caching and integrity
  headers", "Network-denying artifact CSP").
  - A browser that cached an artifact as `immutable` before local mode was first enabled still
    holds the old policy for that exact URL. The runbook tells developers to hard-refresh once,
    or clear the site data, after switching drivers.
  - `add-memory-box-template` also adds tests next to the `template-artifacts` route. Edits there
    are additive.
- An explicit path source is used rather than `'self'` in the template policy for two reasons:
  - the template document runs with an opaque origin (`sandbox="allow-scripts"`), and relying on
    how browsers resolve `'self'` there is unnecessary;
  - `'self'` would grant every template same-origin image loads in every mode.
- Application pages already allow `'self'`. Listing the origin explicitly also covers a page served
  from another host alias (for example `127.0.0.1` vs `localhost`) for images. Uploads still
  require browsing at the `APP_URL` origin, because a cross-origin `PUT` has no CORS support; the
  runbook says so.

### D7. Readiness and worker modes

- `/api/health/ready` calls `getStorageConfiguration()` instead of `getStorageEnvironment()`.
- `assertMediaRuntimeReady(environment, storageDriver)` additionally throws when the driver is
  `local` and the effective worker mode is `trigger`. The inline worker (web process) and
  `pnpm media:work` use the same adapter through composition.
- The Trigger.dev tasks keep calling `getMediaWorker()`. Deployed tasks have no local
  configuration and keep Blob. `pnpm jobs:dev` with the local driver is unsupported (Non-goals).

### D8. Playwright and E2E

- `playwright.config.ts` `webServer.env` adds:
  - `STORAGE_DRIVER: "local"`;
  - `APP_URL: baseURL`;
  - `LOCAL_OBJECT_STORAGE_SECRET: process.env["LOCAL_OBJECT_STORAGE_SECRET"] ?? "playwright-local-object-storage-secret-0001"`.
- Playwright merges `process.env` with `webServer.env`, and `next-with-root-env.mjs` does not
  override exported variables, so these win over a developer's root `.env`. CI needs no workflow
  change.
- New `apps/web/e2e/media-upload.spec.ts`. It depends on `add-memory-box-template` (seeded
  `memory-box@1.1.0` whose photos are the `captionedImageList` field `memories` in step
  `memories`) and on `add-schema-driven-studio` (the `?field=` deep link, and the id
  `studio-field-{fieldId}` on every field's primary control). Both are archived before this change
  in the Sprint 3 order. The journey:
  1. create a `memory-box` draft through the existing create flow and read its `publicId`;
  2. navigate explicitly to `/studio/{publicId}?field=memories`;
  3. within `#studio-field-memories`, set a committed small JPEG fixture
     (`apps/web/e2e/fixtures/photo.jpg`, a few KB, no personal EXIF data) on the file input
     labelled `Chọn ảnh`;
  4. confirm the crop;
  5. wait until the item shows its ready image with `naturalWidth > 0`.
- The spec also asserts through `request` that:
  - the derivative URL returns `image/webp` with `Cache-Control: private, no-store`;
  - a tampered signature returns `403`;
  - a traversal path returns `404`;
  - `DELETE` returns `405`.
- Files written by E2E live under `.tmp/object-storage/` with random UUID keys, so parallel
  workers and repeated runs do not collide. The directory can be deleted at any time.

### D9. Data, authorization, retry

- Data: no MongoDB change. Asset documents keep `sourceKey` and derivative keys. The keys are the
  same strings in both drivers, so a developer can switch drivers only on a fresh database (old
  keys point at the other store). The runbook says so.
- Authorization: unchanged. Grants and download URLs are issued only by the media service after
  gift authorization. The local route authorizes solely by signature and expiry.
- Failure and retry: an interrupted `PUT` leaves nothing and can be retried with the same URL until
  it expires. Completion, processing retries and cleanup behave exactly as on Blob because the
  adapter raises the same error classes.

## Risks / Trade-offs

- **`VERCEL_ENV` pulled into `.env.local` by `vercel env pull`** would make the local driver refuse
  on a developer machine. → This is intentional fail-closed behavior. The runbook tells developers
  either to use Blob with the pulled credentials or to not set `STORAGE_DRIVER=local` alongside a
  pulled preview environment.
- **Local mode enabled on a non-Vercel shared host** (for example a self-hosted demo) is not
  detected. → Non-goal; the runbook and `.env.example` label the driver development/E2E only, and
  every deployment path in this project is Vercel (AGENTS.md forbids ad-hoc deploys).
- **Hard links unsupported** on an exotic filesystem (for example some network drives). → The
  exclusive commit falls back to failing the write with a clear error. `.tmp/` is on the repository
  disk.
- **The signing secret leaks** from the test value in `playwright.config.ts`. → It only protects
  throwaway local files. Local mode is refused on Vercel, so the value is useless against any
  deployment. `pnpm test:secrets` already tolerates the similar `BETTER_AUTH_SECRET` test value.
- **Template image rendering in local mode** is only exercised end to end once preview exists. →
  CSP unit tests pin the header. `add-gift-preview`'s E2E renders template images and proves it.
- **Absolute URLs depend on browsing at `APP_URL`.** → The runbook says so; the E2E sets `APP_URL`
  to the Playwright base URL.

## Migration Plan

1. Ship the storage package changes. The default driver is unchanged, so deployments are
   unaffected. `getStorageEnvironment` remains exported for the Blob path.
2. Ship the route, CSP and readiness changes together in one Next.js deployment. On Vercel the
   route answers `404` and the CSP is byte-for-byte unchanged.
3. No database migration.
4. Rollback: revert the deployment. Local files under `.tmp/` can be deleted.
