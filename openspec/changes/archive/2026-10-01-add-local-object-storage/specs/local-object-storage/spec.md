# Spec Delta

## Purpose

Provides a filesystem-backed private object store for local development and Playwright runs, so
the media upload and processing pipeline works without Vercel Blob credentials. It covers driver
selection and the fail-closed refusal on Vercel, the signed same-origin upload and download routes,
key validation and the adapter's parity with the Blob storage contract. The upload and asset APIs
are specified in `media-upload`, processing in `media-processing`, the policy origins in
`content-security-policy` and readiness in `health-checks`.

## ADDED Requirements

### Requirement: Storage driver selection

The system SHALL select the object storage driver from `STORAGE_DRIVER`, which MUST be
`vercel-blob` or `local` when set; an empty or unset value SHALL select `vercel-blob`, and any other
value SHALL be a configuration error. The `vercel-blob` driver SHALL keep its existing credential
rules. The `local` driver SHALL require `LOCAL_OBJECT_STORAGE_SECRET` of 32 to 256 characters and an
`APP_URL` that is an absolute `http:` or `https:` URL, SHALL use the origin of `APP_URL` as the
local storage origin for every URL it issues, and SHALL keep objects under the `.tmp/object-storage`
directory of the repository workspace root, whichever process (web server or media worker command)
uses it. A configuration error SHALL prevent object storage from being constructed; a media
operation that needs storage SHALL then fail without writing any object (`500` `INTERNAL_ERROR` on
the media routes, `503` `SERVICE_UNAVAILABLE` on the spike upload routes).

#### Scenario: Default driver

- **WHEN** `STORAGE_DRIVER` is unset or empty
- **THEN** the Vercel Blob driver is used with its existing credential rules

#### Scenario: Unknown driver rejected

- **WHEN** `STORAGE_DRIVER` is `s3` or `LOCAL`
- **THEN** reading the storage configuration fails with a validation error

#### Scenario: Local driver without a usable secret

- **WHEN** `STORAGE_DRIVER` is `local` and `LOCAL_OBJECT_STORAGE_SECRET` is unset or shorter than 32
  characters
- **THEN** reading the storage configuration fails with a validation error
- **AND** `POST /api/media/uploads/init` for an authorized draft responds `500` with code
  `INTERNAL_ERROR` and no asset or object is left behind

#### Scenario: Local driver without an application URL

- **WHEN** `STORAGE_DRIVER` is `local` and `APP_URL` is unset
- **THEN** reading the storage configuration fails with a validation error

#### Scenario: Web server and worker share one directory

- **WHEN** the web server runs from `apps/web` and `pnpm media:work` runs from the repository root,
  both with `STORAGE_DRIVER` `local`
- **THEN** both read and write objects under the same `<workspace root>/.tmp/object-storage`
  directory

### Requirement: Local storage refused on Vercel

The system MUST refuse the `local` driver whenever `VERCEL_ENV` is set to a non-empty value other
than `development`, including `production` and `preview`. A refusal SHALL be a configuration error
as defined in "Storage driver selection", SHALL NOT fall back to Vercel Blob, SHALL keep every
`/api/local-object-storage/` route answering `404`, and SHALL NOT add the local storage origin to
any Content Security Policy. `NODE_ENV` SHALL NOT influence the refusal, so a local production build
(`next start`) may use the `local` driver.

#### Scenario: Production deployment refuses local storage

- **WHEN** `VERCEL_ENV` is `production` and `STORAGE_DRIVER` is `local` with a valid secret and
  `APP_URL`
- **THEN** reading the storage configuration fails with a validation error
- **AND** `PUT /api/local-object-storage/private/assets/<uuid>/source` with an otherwise valid
  signature responds `404` with code `NOT_FOUND` and writes nothing

#### Scenario: Preview deployment refuses local storage

- **WHEN** `VERCEL_ENV` is `preview` and `STORAGE_DRIVER` is `local`
- **THEN** reading the storage configuration fails with a validation error
- **AND** `GET /api/health/ready` responds `503`

#### Scenario: Local production build allowed

- **WHEN** `NODE_ENV` is `production`, `VERCEL_ENV` is unset and `STORAGE_DRIVER` is `local` with a
  valid secret and `APP_URL`
- **THEN** the local driver is used

### Requirement: Signed local object URLs

The system SHALL issue local object URLs of the form
`<local storage origin>/api/local-object-storage/<key>` where each key segment is percent-encoded,
with the query parameters `expires` (Unix time in whole seconds) and `signature`, plus
`contentType` and `maxBytes` for upload URLs. `signature` SHALL be the unpadded base64url encoding
of an HMAC-SHA256, keyed with `LOCAL_OBJECT_STORAGE_SECRET`, over a versioned canonical string that
binds the HTTP method (`PUT` or `GET`), the key, `expires`, and for `PUT` the content type and the
maximum size. The routes SHALL verify the signature in constant time and SHALL answer `403` with
code `FORBIDDEN` when a signature parameter is missing or malformed, the signature does not match,
the URL was signed for the other method, or the current time is at or after `expires`. Download
URLs SHALL expire 300 seconds after issuance unless the caller requests another TTL, and upload
URLs SHALL expire after the TTL requested for the grant. Error responses SHALL use the standard
error envelope and MUST NOT echo the key, the signature, the secret or a filesystem path.

#### Scenario: Valid download URL

- **WHEN** an authorized caller reads a `ready` asset in local mode
- **THEN** each derivative `url` starts with the `APP_URL` origin followed by
  `/api/local-object-storage/`, carries `expires` 300 seconds after issuance, and a `GET` of it
  responds `200`

#### Scenario: Tampered signature

- **WHEN** a client requests a download URL whose `signature` has one character changed, or whose
  key path was changed after signing
- **THEN** the response is `403` with code `FORBIDDEN`

#### Scenario: Expired URL

- **WHEN** a client uses an upload or download URL at or after its `expires` time
- **THEN** the response is `403` with code `FORBIDDEN`
- **AND** no object is written or read

#### Scenario: Method not granted

- **WHEN** a client sends `PUT` to a URL that was signed for `GET`, or `GET` to a URL that was
  signed for `PUT`
- **THEN** the response is `403` with code `FORBIDDEN`

#### Scenario: Different secret

- **WHEN** a URL signed with one `LOCAL_OBJECT_STORAGE_SECRET` is used after the server restarts
  with another secret
- **THEN** the response is `403` with code `FORBIDDEN`

### Requirement: Object key validation

The system SHALL accept an object key only when it is 1 to 512 characters long and consists of
1 to 16 `/`-separated segments, where each segment is 1 to 128 characters from `A-Z`, `a-z`, `0-9`,
`.`, `_` and `-`, does not start or end with `.`, and is not a reserved device name (`CON`, `PRN`,
`AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, case-insensitive, with or without an extension). Keys
SHALL be validated after URL decoding, and every resolved file path MUST stay inside the local
object directory. An invalid key SHALL be answered `404` with code `NOT_FOUND` before the signature
is checked and before any filesystem access; the adapter SHALL refuse to issue URLs for, read,
write or delete an invalid key.

#### Scenario: Keys used by the pipeline

- **WHEN** the adapter issues URLs for `private/assets/<uuid>/source`,
  `private/assets/<uuid>/derivatives/w768.webp` or `private/spikes/<uuid>/source`
- **THEN** the keys are accepted

#### Scenario: Traversal attempt

- **WHEN** a client requests `/api/local-object-storage/private/assets/%2E%2E/%2E%2E/.env`,
  `/api/local-object-storage/private/..%2F..%2Fsecret` or a key containing `\` or `:`
- **THEN** the response is `404` with code `NOT_FOUND`
- **AND** no file outside the local object directory is read, created or deleted

#### Scenario: Reserved device name

- **WHEN** a client requests a key with a segment `nul` or `con.txt`
- **THEN** the response is `404` with code `NOT_FOUND`

### Requirement: Signed local upload

The system SHALL accept `PUT /api/local-object-storage/<key>` only in local mode and only with a
valid upload signature for that key. The request `Content-Type` media type MUST equal the signed
`contentType` (case-insensitive, parameters ignored), otherwise the response SHALL be `415` with
code `VALIDATION_ERROR`. A declared `Content-Length` above the signed `maxBytes` SHALL be rejected
with `413` and code `VALIDATION_ERROR` before the body is read, and a body that grows beyond
`maxBytes` while it is read SHALL be rejected the same way. An upload SHALL NOT overwrite an
existing object: if the key already holds an object, the response SHALL be `409` with code
`CONFLICT`. A rejected or interrupted upload SHALL leave no object and no partial file at the key.
An accepted upload SHALL store the bytes together with the signed content type, the byte length and
a SHA-256 entity tag, and respond `204`. The route SHALL NOT require cookies or a session; the
signature is its only authorization.

#### Scenario: Studio upload succeeds

- **WHEN** the Studio sends the cropped image with `PUT` to the grant `url` with the grant
  `headers`, within the grant TTL and size
- **THEN** the response is `204`
- **AND** `POST /api/media/uploads/complete` then responds `202` with `status` `uploaded`

#### Scenario: Wrong content type

- **WHEN** a client sends `Content-Type: image/png` to an upload URL signed for `image/jpeg`
- **THEN** the response is `415` with code `VALIDATION_ERROR` and no object is stored

#### Scenario: Oversized body

- **WHEN** a client sends 4097 bytes to an upload URL signed with `maxBytes` 4096, with or without a
  `Content-Length` header
- **THEN** the response is `413` with code `VALIDATION_ERROR`
- **AND** no object or partial file exists at the key

#### Scenario: Second upload to the same key

- **WHEN** a client repeats a successful `PUT` with the same valid URL
- **THEN** the response is `409` with code `CONFLICT` and the first object is unchanged

### Requirement: Signed local download

The system SHALL answer `GET /api/local-object-storage/<key>` in local mode with a valid download
signature by streaming the stored bytes with status `200`, `Content-Type` set to the stored content
type, `Content-Length` set to the stored byte length, `Cache-Control: private, no-store`,
`X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` and
`X-Robots-Tag: noindex`. A valid signature for a key that holds no object SHALL respond `404` with
code `NOT_FOUND`. The response SHALL NOT set cookies and SHALL NOT be cacheable by shared caches.

#### Scenario: Derivative served to the Studio

- **WHEN** the Studio renders a `ready` asset's derivative `url`
- **THEN** the image loads with `Content-Type: image/webp` and `Cache-Control: private, no-store`

#### Scenario: Object removed

- **WHEN** a client uses a valid download URL after the asset was deleted
- **THEN** the response is `404` with code `NOT_FOUND`

### Requirement: Local routes inactive outside local mode and method handling

The system SHALL answer `GET`, `HEAD` and `PUT` requests under `/api/local-object-storage/` with
`404` and code `NOT_FOUND` (no body for `HEAD`), without verifying signatures or touching the
filesystem, whenever the effective driver is not `local`, including when the `local` driver is
refused or misconfigured. In every mode, `POST`, `PATCH` and `DELETE` SHALL respond `405` without
touching the filesystem, and `OPTIONS` SHALL respond `204` with `Allow: GET, HEAD, OPTIONS, PUT`
and no body. `HEAD` SHALL be handled by the download route with the method `HEAD`: because URLs are
only ever signed for `GET` or `PUT`, a `HEAD` request in local mode SHALL respond `404` for an
invalid key and otherwise `403` with code `FORBIDDEN`, without a body and without reading an
object.

#### Scenario: Blob deployment

- **WHEN** `STORAGE_DRIVER` is unset and a client requests
  `GET /api/local-object-storage/private/assets/<uuid>/source?expires=...&signature=...`
- **THEN** the response is `404` with code `NOT_FOUND`

#### Scenario: Refused driver answers upload with not found

- **WHEN** `VERCEL_ENV` is `preview`, `STORAGE_DRIVER` is `local` and a client sends `PUT` to a
  local object URL
- **THEN** the response is `404` with code `NOT_FOUND` and nothing is written

#### Scenario: Unsupported method

- **WHEN** a client sends `DELETE` or `POST` to `/api/local-object-storage/private/assets/<uuid>/source`
  in any mode
- **THEN** the response is `405` and nothing is deleted or written

#### Scenario: HEAD with a download signature

- **WHEN** in local mode a client sends `HEAD` to a valid, unexpired download URL
- **THEN** the response is `403` with no body

### Requirement: Signed URLs kept out of logs

The system MUST NOT write local object URLs, their `signature` or `expires` values, object keys or
filesystem paths to any log. The local object routes SHALL log only a fixed operation name, a
request id and an error name, and the development server's incoming-request log SHALL ignore every
request whose path starts with `/api/local-object-storage/`.

#### Scenario: Development request log

- **WHEN** `next dev` serves `PUT` and `GET` requests to signed local object URLs
- **THEN** none of those requests appears in the incoming-request log

#### Scenario: Failed upload logged safely

- **WHEN** a local upload fails with an unexpected filesystem error
- **THEN** the log entry contains a fixed operation name, the request id and the error name only
- **AND** it contains no URL, signature, key or path

### Requirement: Local adapter parity with Blob storage

The local adapter SHALL honor the same storage contract that the media pipeline relies on from the
Blob adapter: an upload grant with `method` `PUT`, `headers` `{ "content-type": <declared type> }`,
an absolute `url` and `expiresAt` equal to issuance plus the requested TTL; metadata reads that
return the stored byte length and content type; bounded reads that fail with a too-large error
when the object exceeds the requested maximum; server-side writes that refuse to overwrite unless
overwrite is requested; deletes that succeed when the object is already absent; and distinct
not-found errors for missing objects, so completion still marks a never-uploaded asset
`OBJECT_MISSING`. The adapter SHALL be used for every storage operation of the process, including
the inline media worker, `pnpm media:work` and the technical spike upload lab.

#### Scenario: Completion without an uploaded object

- **WHEN** completion is requested in local mode for an asset whose upload `PUT` never happened
- **THEN** the asset becomes `failed` with `failureCode` `OBJECT_MISSING`
- **AND** the response is `422` with code `VALIDATION_ERROR`

#### Scenario: Local image becomes ready

- **WHEN** a valid JPEG is uploaded and completed in local mode with `MEDIA_WORKER_MODE` `inline`
- **THEN** the asset reaches `ready` with WebP derivatives written through the local adapter
- **AND** the source object is removed

#### Scenario: Oversized stored object read

- **WHEN** the worker reads a local object larger than the requested maximum bytes
- **THEN** the read fails with the too-large error and the asset follows the existing processing
  failure rules
