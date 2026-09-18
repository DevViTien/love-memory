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
- `failed / PROCESSING_FAILED`: transient decode/storage failure; retry from Studio while attempts are below three.
- `processing` older than ten minutes: lease is considered stale and can be reclaimed.
- `deleting` past `expiresAt`: a synchronous delete did not finish; the scheduled sweep retries source and derivative cleanup.
- `ready` with source object still present: derivative commit succeeded but source cleanup failed; safe to delete the source key manually after confirming derivatives.

Never place Blob URLs, binary bytes, or base64 image data in a gift document. Gift content stores opaque asset UUIDs only.
