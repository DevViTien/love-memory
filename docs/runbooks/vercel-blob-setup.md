# Vercel Blob setup

This runbook configures the private media store used by the Sprint 0 upload lab and later media
pipeline. Do not paste credentials into chat, issues, screenshots or commits.

## Create and connect the store

1. Import the GitHub repository into a Vercel Project. A successful deployment is not required yet.
2. In that Project, open **Storage → Create Database → Blob**.
3. Name the store `love-memory-media-dev` and choose **Private** access.
4. Choose a region near the primary users and MongoDB Atlas deployment.
5. Connect the store to Development and Preview. Keep Production isolated until the release gate.
6. Confirm the Project has Blob credentials. Current Vercel deployments should use OIDC-backed
   `VERCEL_OIDC_TOKEN` plus `BLOB_STORE_ID`; a connected legacy store may expose
   `BLOB_READ_WRITE_TOKEN`.

Private/public access cannot be changed after store creation. Do not reuse a public store for couple
photos.

## Local environment

The Next.js application reads environment variables from `apps/web/.env.local`, not the repository
root `.env` used as a personal source file.

Copy the non-secret keys from `.env.example`, then set locally:

```dotenv
MONGODB_URI=<existing Atlas URI>
MONGODB_DATABASE=love_memory
APP_URL=http://localhost:3000
BLOB_READ_WRITE_TOKEN=<local development token from the connected private store>
TECHNICAL_SPIKES_ENABLED=true
TECHNICAL_SPIKE_TOKEN=<random secret with at least 24 characters>
```

Never prefix Blob credentials with `NEXT_PUBLIC_`. Do not manually copy `VERCEL_OIDC_TOKEN` from a
deployment; OIDC is supplied and rotated by Vercel.

## Verification

1. Start the app with `pnpm dev` and open `/studio/spikes`.
2. Enter only the `TECHNICAL_SPIKE_TOKEN` in the protected lab.
3. Upload one non-sensitive JPEG/PNG/WebP under 10 MiB.
4. Confirm direct upload, server validation, WebP derivative and expiring signed preview all pass.
5. Run the MongoDB probe.
6. In Vercel Preview, repeat the upload and confirm functions authenticate through OIDC.
7. Confirm logs contain request IDs and error names only—never tokens, signed URLs, filenames or
   gift content.

If Blob fails, turn `TECHNICAL_SPIKES_ENABLED` off. Existing objects remain private. If a static
token may have leaked, revoke it in Vercel immediately and generate/pull a replacement.
