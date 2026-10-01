# Media pipeline runbook

## Runtime flow

1. Studio requests a short-lived, size/MIME-bound private Blob PUT URL.
2. The browser uploads directly to Vercel Blob and calls the completion endpoint.
3. The API verifies Blob metadata, moves the asset to `uploaded`, and creates one durable `media.process.v1` outbox record in the same MongoDB transaction.
4. The API dispatches the `media-worker-drain` Trigger.dev task after committing the outbox record. Trigger.dev only wakes the worker; MongoDB remains the durable source of truth. The worker decodes the bytes with Sharp, verifies the real MIME, auto-orients, strips metadata, and creates 320/768/1280 WebP derivatives plus a tiny placeholder and SHA-256 checksum.
5. Metadata is committed before best-effort source cleanup. A failed source cleanup is observable but never downgrades a ready asset.

The `media-worker-sweep` task runs every five minutes. It picks up due retries, reclaims `processing` jobs that have been stale for ten minutes, and cleans abandoned uploads. Processing attempts are bounded at three. Studio only offers a manual retry for transient `PROCESSING_FAILED` assets; invalid or missing source bytes are terminal.

## Local operation

Run the schema migration once after pulling Sprint 2:

```bash
pnpm db:migrate
pnpm db:verify
```

Schema v6 also removes the legacy `assets_storage_key_unique` index, uses a partial unique `sourceKey` index, and reserves per-gift/per-field quota slots atomically. The slot indexes prevent concurrent upload requests from exceeding template limits.

Keep `MEDIA_WORKER_MODE=inline` locally so a successful completion or retry invokes the worker immediately. To drain pending jobs and abandoned upload cleanup manually:

```bash
pnpm media:work
```

The command processes at most 100 records per invocation and exits when the queue is empty.

To prove the media repositories work against a real deployment (Stable API strict mode,
transactions, slot indexes, outbox claim and cleanup) without touching object storage, run
`pnpm db:verify-media`. It uses a clock in the year 2000 so it never claims real jobs, and it removes
everything it created. CI runs it after `pnpm db:verify-gifts`.

## Local object storage

Local development and Playwright can run the whole upload → complete → process → signed-read path
without Blob credentials by storing objects on the local disk. This is a development/E2E tool only:
it is refused on every Vercel deployment and gives no durability, backup or multi-instance
guarantee.

```text
STORAGE_DRIVER=local
LOCAL_OBJECT_STORAGE_SECRET=<32–256 random characters>
APP_URL=http://localhost:3000
MEDIA_WORKER_MODE=inline
```

- Generate the secret once, for example with
  `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. It signs
  the upload and download URLs; changing it invalidates every URL already issued.
- `APP_URL` must be the origin you browse. Signed URLs are absolute `APP_URL` URLs under
  `/api/local-object-storage/`, and the Studio upload `PUT` has no CORS support, so browsing at
  `127.0.0.1` while `APP_URL` says `localhost` makes uploads fail.
- Objects live under `<workspace root>/.tmp/object-storage/` (`objects/` bytes, `metadata/` JSON
  sidecars, `incoming/` temporary files). The web server (cwd `apps/web`) and `pnpm media:work`
  (cwd root) share this directory. Stop the server, then delete the directory whenever you like;
  assets that still reference it will then fail with `OBJECT_MISSING` or broken previews.
- Only the `inline` worker and `pnpm media:work` can read local objects. Readiness answers `503`
  when `STORAGE_DRIVER=local` is combined with the `trigger` worker mode, and `pnpm jobs:dev` is
  not supported against local storage.
- The driver is refused (storage cannot be constructed, media routes answer `500`, readiness `503`,
  the local routes `404`) whenever `VERCEL_ENV` is set to anything but `development`. A
  `vercel env pull` that writes `VERCEL_ENV=preview` or `production` into `.env.local` therefore
  disables local storage for `pnpm dev`: either use Blob with the pulled credentials or remove that
  variable. The Playwright web server sets `VERCEL_ENV` to an empty value itself, so E2E runs keep
  local storage even when `.env.local` came from `vercel env pull`.
- Object keys are the same strings in both drivers, so switching drivers needs a fresh database
  (`MONGODB_DATABASE`); existing asset records would point at objects in the other store.
- In local mode template artifacts are served `no-store`, because their `img-src` then lists the
  local object route of the `APP_URL` origin (`<origin>/api/local-object-storage/`). A browser that cached an artifact as `immutable` before the switch keeps the
  old policy: hard-refresh once, or clear the site data, after switching drivers.
- Signed URLs are credentials. The local routes log only an operation name, a request id and an
  error name, and `next dev` does not print requests under `/api/local-object-storage/`.

Playwright sets `STORAGE_DRIVER=local`, `APP_URL` to its base URL and a fixed test secret (or
`LOCAL_OBJECT_STORAGE_SECRET` from the environment) for its web server, so CI needs no Blob secret.

## Trigger.dev environments

Production-like deployments must set:

```text
MEDIA_WORKER_MODE=trigger
TRIGGER_PROJECT_REF=<Trigger.dev project ref>
TRIGGER_SECRET_KEY=<environment-specific Trigger.dev secret>
BLOB_STORE_ID=<connected Vercel Blob store id>
```

The Trigger.dev runtime must also receive `MONGODB_URI`, `MONGODB_DATABASE`, and
`BLOB_READ_WRITE_TOKEN`. It runs outside Vercel and therefore cannot use the rotating
OIDC token from Vercel request context. If `BLOB_STORE_ID` is synchronized as well,
the storage adapter deliberately prefers the explicit read-write token when no
`VERCEL_OIDC_TOKEN` is present.

Run `pnpm jobs:dev` to execute tasks against the development Trigger.dev environment. Run `pnpm jobs:deploy` from the intended release environment to publish the task definitions. Use a distinct Trigger.dev environment secret for dev, staging, and production, and keep its environment URL aligned with the corresponding LoveMemory deployment. A drain task schedules a queued continuation whenever it consumes a full batch, so a burst does not wait for the five-minute sweep.

If task dispatch fails after upload completion, the API records an operational error but still returns `202`: the committed MongoDB outbox record is not lost and the scheduled sweep will process it.

## Failure checks

- `initiated` past `expiresAt`: source is abandoned and is deleted by the worker cleanup path.
- `failed / UPLOAD_INVALID`: declared Blob metadata or decoded MIME did not match; do not retry the same bytes.
- `failed / DECODE_FAILED` or `OBJECT_MISSING`: the bytes are not a supported image, or the source was never uploaded; terminal, the source is deleted.
- `failed / PROCESSING_FAILED`: transient storage or processing failure (not a decode error); retry from Studio while attempts are below three. After the third attempt the source is deleted and the creator can only remove the asset.
- `processing` older than ten minutes: lease is considered stale and can be reclaimed.
- `deleting` past `expiresAt`: a synchronous delete did not finish; the scheduled sweep retries source and derivative cleanup.
- `ready` with source object still present: derivative commit succeeded but source cleanup failed; safe to delete the source key manually after confirming derivatives.

Never place Blob URLs, binary bytes, or base64 image data in a gift document. Gift content stores opaque asset UUIDs only.
