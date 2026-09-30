# Database Schema Management

## Purpose

Defines how the MongoDB database used by LoveMemory is configured, connected to and brought to a
reproducible schema: the collection registry, idempotent migrations recorded in a migration ledger,
JSON-schema validators, named (including TTL) indexes, template catalog seeding, and the operator
commands that apply and verify all of it. It also covers validation of the server runtime
configuration that these components depend on. Business rules for the stored documents belong to
their owning capabilities.

## Requirements

### Requirement: Runtime configuration validation

The system SHALL validate its database and server URL configuration at the boundary and MUST reject
invalid values with an error instead of silently falling back to a default.

- `MONGODB_URI` is required and MUST start with `mongodb://` or `mongodb+srv://`.
- `MONGODB_DATABASE` defaults to `love_memory`, MUST be 1 to 80 characters long and MUST NOT contain
  `/`, `\`, `.`, `"`, `$`, `*`, `<`, `>`, `:`, `|`, `?` or the NUL character.
- `APP_URL` and `ASSET_ORIGIN` are optional; an empty value is treated as unset; a configured value
  MUST be an absolute `http:` or `https:` URL. `ASSET_ORIGIN` is normalized to its origin (scheme,
  host and port only).

MongoDB configuration SHALL be validated on each database access, so no connection is attempted
with invalid settings.

#### Scenario: Default database name

- **WHEN** `MONGODB_URI` is `mongodb+srv://cluster.example` and `MONGODB_DATABASE` is unset
- **THEN** the database `love_memory` is used

#### Scenario: Non-MongoDB URI rejected

- **WHEN** `MONGODB_URI` is `https://example.com`
- **THEN** database access fails with a validation error and no connection is attempted

#### Scenario: Unsafe database name rejected

- **WHEN** `MONGODB_DATABASE` is `love/memory`
- **THEN** database access fails with a validation error

#### Scenario: Asset origin normalized

- **WHEN** `ASSET_ORIGIN` is `https://cdn.example/assets`
- **THEN** the effective asset origin is `https://cdn.example`

#### Scenario: Non-HTTP URL rejected

- **WHEN** `ASSET_ORIGIN` is `javascript:alert(1)` or `ftp://cdn.example`
- **THEN** reading the web configuration fails with a validation error

### Requirement: Bounded shared connection pool

The system SHALL use at most one MongoDB client per server process, shared by all requests, and
SHALL configure it with `appName` `love-memory`, `maxPoolSize` `10`, `maxIdleTimeMS` `60000`,
`serverSelectionTimeoutMS` `5000`, `socketTimeoutMS` `15000`, `waitQueueTimeoutMS` `5000`,
`retryReads` and `retryWrites` enabled, and the Stable API version `1` with `strict` and
`deprecationErrors` enabled. Concurrent callers that arrive while the client is connecting SHALL
share the same connection attempt. In non-production runtimes the client SHALL survive module
reloads within the same process.

#### Scenario: Concurrent requests reuse one client

- **WHEN** two requests obtain the database client at the same time
- **THEN** both receive the same client instance and only one connection attempt is made

### Requirement: Recovery after a failed initial connection

The system SHALL close a client whose initial connection fails and SHALL discard the failed attempt,
so that the next database access starts a new connection attempt instead of reusing the rejected
one.

#### Scenario: Temporary outage recovers

- **WHEN** the first connection attempt fails because MongoDB is temporarily unavailable
- **AND** a later request accesses the database after MongoDB becomes available
- **THEN** the later request triggers a new connection attempt and succeeds

### Requirement: Collection registry

The system SHALL use these stable, unique collection names: `accounts`, `abuseReports`,
`apiRateLimits`, `assets`, `authRateLimits`, `databaseMigrations`, `giftRevisions`, `gifts`,
`idempotencyKeys`, `jobOutbox`, `orders`, `paymentAttempts`, `reactions`, `sessions`,
`templateVersions`, `templates`, `technicalSpikes`, `users`, `verifications`. The migration SHALL
manage these collections: `users`, `sessions`, `accounts`, `verifications`, `authRateLimits`,
`apiRateLimits`, `templates`, `templateVersions`, `gifts`, `giftRevisions`, `assets`,
`idempotencyKeys`, `jobOutbox`; `databaseMigrations` SHALL hold the migration ledger. The names
`abuseReports`, `orders`, `paymentAttempts`, `reactions` and `technicalSpikes` are reserved and are
not created or verified by the migration.

#### Scenario: Migration creates managed collections

- **WHEN** migrations run against an empty database
- **THEN** every managed collection exists afterwards

### Requirement: JSON-schema validators

The system SHALL apply a `$jsonSchema` validator (allowing additional properties) to `apiRateLimits`,
`templates`, `templateVersions`, `gifts`, `giftRevisions`, `assets`, `idempotencyKeys` and
`jobOutbox`, including at least these constraints:

- `apiRateLimits` requires `_id`, `count` (int >= 1), `scope` (one of `gift-claim`, `gift-create`,
  `gift-update`, `media-upload`), `subjectHash` (64 lowercase hex characters), `expiresAt`,
  `createdAt`, `updatedAt`;
- `templates` requires `_id`, `currentVersion`, `status` (`draft`, `published`, `retired`),
  `createdAt`, `updatedAt`;
- `templateVersions` requires `_id`, `templateId`, `version`, `status` (`draft`, `published`,
  `retired`), `manifest` (object), `createdAt`, `updatedAt`;
- `gifts` requires `_id`, `publicId`, `ownership`, `content` (object), `revision` (int >= 0),
  `status` (`draft`, `publishing`, `scheduled`, `published`, `paused`, `expired`, `deleting`,
  `deleted`), `createdAt`, `updatedAt`; `ownership` requires `anonymousDraftId`, `claimTokenHash`
  and `ownerId` and MUST be either anonymous (string draft id and claim token hash, null owner) or
  owned (null draft id and claim token hash, string owner);
- `giftRevisions` requires `_id`, `giftId`, `revision` (int >= 0), `content` (object), `createdAt`;
- `assets` requires `_id`, `giftId`, `fieldId`, `giftSlot`, `fieldSlot`, `ownerId`,
  `anonymousDraftId`, `sourceKey`, `declaredContentType` (`image/jpeg`, `image/png`, `image/webp`),
  `declaredSizeBytes` (>= 1), `status` (`initiated`, `uploaded`, `processing`, `ready`, `failed`,
  `deleting`, `deleted`), `attempts` (int >= 0), `derivatives` (array), `placeholderDataUrl`,
  `checksumSha256`, `failureCode`, `expiresAt`, `createdAt`, `updatedAt`;
- `idempotencyKeys` requires `_id`, `actorKey`, `giftId`, `scope`, `key`, `requestFingerprint`,
  `expiresAt`, `createdAt`, `updatedAt`, with non-empty `actorKey`, `giftId` and
  `requestFingerprint`;
- `jobOutbox` requires `_id`, `type`, `payload` (object), `status` (`pending`, `processing`,
  `completed`, `failed`), `attempts` (int >= 0), `availableAt`, `deduplicationKey`, `createdAt`,
  `updatedAt`.

Existing collections SHALL have their validator replaced with the current definition on every
migration run.

#### Scenario: Validator updated on an existing collection

- **WHEN** migrations run and the `gifts` collection already exists with an outdated validator
- **THEN** the `gifts` validator is replaced with the current definition

#### Scenario: Invalid gift ownership rejected by MongoDB

- **WHEN** a document is inserted into `gifts` whose `ownership` has both a string `ownerId` and a string `claimTokenHash`
- **THEN** MongoDB rejects the write with a document validation error

### Requirement: Named indexes

The system SHALL maintain these named indexes and MUST keep every index name unique:

- `users`: `users_email_unique` (unique `email`);
- `sessions`: `sessions_token_unique` (unique `token`), `sessions_user_expiry`, `sessions_expiry_ttl`;
- `accounts`: `accounts_provider_account_unique` (unique `providerId` + `accountId`), `accounts_user`;
- `verifications`: `verifications_identifier`, `verifications_expiry_ttl`;
- `authRateLimits`: `auth_rate_limits_key_unique` (unique `key`);
- `apiRateLimits`: `api_rate_limits_expiry_ttl`;
- `templates`: `templates_status_order`;
- `templateVersions`: `template_versions_identity_unique` (unique `templateId` + `version`),
  `template_versions_status`;
- `gifts`: `gifts_public_id_unique` (unique `publicId`), `gifts_owner_updated`,
  `gifts_status_unlock`, `gifts_status_expiry`;
- `giftRevisions`: `gift_revisions_identity_unique` (unique `giftId` + `revision`),
  `gift_revisions_history`;
- `assets`: `assets_source_key_unique` (unique `sourceKey` where it is a string),
  `assets_owner_status_created`, `assets_anonymous_status_created`, `assets_gift_field_created`,
  `assets_active_gift_slot_unique` (unique `giftId` + `giftSlot` for numeric slots in a non-deleted
  status), `assets_active_field_slot_unique` (unique `giftId` + `fieldId` + `fieldSlot` for numeric
  slots in a non-deleted status), `assets_status_expiry`;
- `idempotencyKeys`: `idempotency_scope_key_unique` (unique `scope` + `key`),
  `idempotency_expiry_ttl`;
- `jobOutbox`: `job_outbox_available`, `job_outbox_deduplication` (unique `deduplicationKey`).

The indexes `sessions_expiry_ttl`, `verifications_expiry_ttl`, `api_rate_limits_expiry_ttl` and
`idempotency_expiry_ttl` SHALL be TTL indexes on `expiresAt` with `expireAfterSeconds` `0`, so
MongoDB deletes documents once `expiresAt` has passed. An existing index with an expected name but a
different key, uniqueness, sparseness, TTL, partial filter or collation SHALL be dropped and
recreated. The legacy index `assets_storage_key_unique` SHALL be dropped when present.

#### Scenario: Drifted index is rebuilt

- **WHEN** `gifts_public_id_unique` exists without the unique option and migrations run
- **THEN** the index is dropped and recreated as unique

#### Scenario: Legacy asset index removed

- **WHEN** `assets` has an index named `assets_storage_key_unique` and migrations run
- **THEN** that index no longer exists

#### Scenario: Expired idempotency key removed

- **WHEN** an `idempotencyKeys` document's `expiresAt` is in the past
- **THEN** MongoDB's TTL monitor deletes it without application action

### Requirement: Idempotent migration with ledger

The system SHALL provide `db:migrate`, which converges the database to the current schema (creating
missing collections with validators, updating validators, reconciling indexes) and then upserts the
ledger document `_id: "core"` in `databaseMigrations` with `version` equal to the current schema
version `6`, `appliedAt` set to now, and `createdAt` set only on first insert. Running it repeatedly
SHALL produce the same schema without errors. It SHALL print one JSON line per collection and phase,
`{"collection":<name>,"event":"database_migration","phase":"start"|"complete"}`, and SHALL verify the
schema after migrating.

The `db:migrate`, `db:seed` and `db:verify` commands SHALL read configuration from the environment
and the optional `.env` and `apps/web/.env.local` files, print
`Database command completed successfully.` on success, exit with a non-zero status on any failure,
and always close the MongoDB client before exiting. An unrecognized command MUST fail with
`Expected database command: migrate, seed, or verify.`

#### Scenario: Re-running migrations is safe

- **WHEN** `db:migrate` is run twice against the same database
- **THEN** both runs succeed, the schema verifies, and the ledger `version` is `6`

#### Scenario: Command failure exits non-zero

- **WHEN** any database command fails, for example because verification detects drift
- **THEN** the process exits with a non-zero status and does not print the success message

### Requirement: Schema verification

The system SHALL provide `db:verify`, which fails without modifying the database when any managed
collection is missing (`Missing MongoDB collection`), a validator differs from its definition
(`MongoDB validator mismatch`), a legacy index remains (`Legacy MongoDB index remains`), an expected
index is missing (`Missing MongoDB index`) or differs in key or options (`MongoDB index mismatch`),
or the ledger version differs from `6` or is missing (`MongoDB schema version mismatch`).

#### Scenario: Schema drift detected

- **WHEN** the ledger document records `version` `1`
- **THEN** `db:verify` fails with `MongoDB schema version mismatch: expected 6, received 1.`

#### Scenario: Empty database fails verification

- **WHEN** `db:verify` runs against a database with no collections
- **THEN** it fails with `Missing MongoDB collection`

### Requirement: Template catalog seed

The system SHALL provide `db:seed`, which runs migrations, then idempotently upserts the built-in
templates `memory-box`, `our-timeline` and `midnight-wish` (each version `1.0.0`, status
`published`, `sortOrder` `0`, `1`, `2` respectively), then verifies the schema. Each `templates`
document SHALL be keyed by the template id with `currentVersion`, `sortOrder`, `status` and
timestamps; each `templateVersions` document SHALL be keyed `<templateId>@<version>` with
`templateId`, `version`, `status`, `manifest`, `previewFixture`, `contentHash` (SHA-256 hex of the
serialized manifest) and timestamps. A template's preview fixture MUST validate against its manifest
before it is written; `createdAt` SHALL be preserved on re-seed.

#### Scenario: Seeding twice keeps one document per template

- **WHEN** `db:seed` is run twice
- **THEN** `templates` contains exactly one document each for `memory-box`, `our-timeline` and `midnight-wish`
- **AND** `templateVersions` contains `memory-box@1.0.0`, `our-timeline@1.0.0` and `midnight-wish@1.0.0`

### Requirement: Gift persistence verification

The system SHALL provide `db:verify-gifts`, which exercises gift persistence against the configured
database and fails with a non-zero exit status unless all of the following hold: an anonymous draft
created with a `gift-create` idempotency key is returned to its anonymous accessor; a different user
is denied access; an update at expected revision `0` persists revision `1`; a second update at the
stale revision `0` is rejected; the draft can be claimed by a user; and replaying the original
anonymous idempotency key after the claim yields a conflict. It SHALL delete the gift, its revisions
and its idempotency keys whether or not verification succeeds, and print
`Gift persistence verification completed successfully.` on success.

#### Scenario: Verification leaves no residue

- **WHEN** `db:verify-gifts` completes, successfully or not
- **THEN** no `gifts`, `giftRevisions` or `idempotencyKeys` documents for the verification gift remain

### Requirement: Media persistence verification

The system SHALL provide `db:verify-media`, which exercises the media repositories against the
configured database without touching object storage, and fails with a non-zero exit status unless
all of the following hold: concurrent upload reservations for one field never exceed its limit and
never share a gift or field slot; a reservation beyond the limit is refused; completing an upload
moves the asset to `uploaded` and inserts exactly one `media.process.v1` outbox job; the worker
claim moves the asset to `processing`; a transient failure schedules a retry and a requeue makes the
job available again; a stale exhausted lease fails the asset terminally; and an expired `initiated`
asset is claimed for cleanup. It SHALL delete every asset and outbox document it created whether or
not verification succeeds, and print `Media persistence verification completed successfully.` on
success. CI SHALL run it against a MongoDB replica set that uses the same Stable API settings as the
application.

#### Scenario: Stable API strict mode is exercised

- **WHEN** `db:verify-media` runs against a MongoDB deployment with Stable API strict mode enabled
- **THEN** every repository operation it calls succeeds, or the command fails

#### Scenario: Verification leaves no residue

- **WHEN** `db:verify-media` completes, successfully or not
- **THEN** no `assets` or `jobOutbox` documents created by the verification remain
