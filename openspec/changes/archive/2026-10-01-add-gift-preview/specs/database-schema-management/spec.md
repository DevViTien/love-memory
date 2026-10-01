# Spec Delta

## MODIFIED Requirements

### Requirement: Collection registry

The system SHALL use these stable, unique collection names: `accounts`, `abuseReports`,
`apiRateLimits`, `assets`, `authRateLimits`, `databaseMigrations`, `giftRevisions`, `gifts`,
`idempotencyKeys`, `jobOutbox`, `orders`, `paymentAttempts`, `previewTokens`, `reactions`,
`sessions`, `templateVersions`, `templates`, `technicalSpikes`, `users`, `verifications`. The
migration SHALL manage these collections: `users`, `sessions`, `accounts`, `verifications`,
`authRateLimits`, `apiRateLimits`, `templates`, `templateVersions`, `gifts`, `giftRevisions`,
`assets`, `idempotencyKeys`, `jobOutbox`, `previewTokens`; `databaseMigrations` SHALL hold the
migration ledger. The names `abuseReports`, `orders`, `paymentAttempts`, `reactions` and
`technicalSpikes` are reserved and are not created or verified by the migration.

#### Scenario: Migration creates managed collections

- **WHEN** migrations run against an empty database
- **THEN** every managed collection exists afterwards, including `previewTokens`

#### Scenario: Upgrading a version 6 database

- **WHEN** migrations run against a database whose ledger records version `6`
- **THEN** `previewTokens` is created with its validator and index, and no document of another
  collection is changed

### Requirement: JSON-schema validators

The system SHALL apply a `$jsonSchema` validator (allowing additional properties) to `apiRateLimits`,
`templates`, `templateVersions`, `gifts`, `giftRevisions`, `assets`, `idempotencyKeys`,
`jobOutbox` and `previewTokens`, including at least these constraints:

- `apiRateLimits` requires `_id`, `count` (int >= 1), `scope` (one of `gift-claim`, `gift-create`,
  `gift-preview`, `gift-update`, `media-upload`), `subjectHash` (64 lowercase hex characters),
  `expiresAt`, `createdAt`, `updatedAt`;
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
  `updatedAt`;
- `previewTokens` requires `_id` (the token's SHA-256 hash, 64 lowercase hex characters), `giftId`
  (non-empty string), `expiresAt` (date) and `createdAt` (date).

Existing collections SHALL have their validator replaced with the current definition on every
migration run.

#### Scenario: Validator updated on an existing collection

- **WHEN** migrations run and the `gifts` collection already exists with an outdated validator
- **THEN** the `gifts` validator is replaced with the current definition

#### Scenario: Invalid gift ownership rejected by MongoDB

- **WHEN** a document is inserted into `gifts` whose `ownership` has both a string `ownerId` and a string `claimTokenHash`
- **THEN** MongoDB rejects the write with a document validation error

#### Scenario: Preview rate-limit scope accepted

- **WHEN** a rate-limit counter with `scope` `gift-preview` is written to `apiRateLimits`
- **THEN** MongoDB accepts it

#### Scenario: Raw preview token rejected

- **WHEN** a document whose `_id` is a 43-character base64url token instead of a 64-character hex
  hash is inserted into `previewTokens`
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
- `jobOutbox`: `job_outbox_available`, `job_outbox_deduplication` (unique `deduplicationKey`);
- `previewTokens`: `preview_tokens_expiry_ttl`.

The indexes `sessions_expiry_ttl`, `verifications_expiry_ttl`, `api_rate_limits_expiry_ttl`,
`idempotency_expiry_ttl` and `preview_tokens_expiry_ttl` SHALL be TTL indexes on `expiresAt` with
`expireAfterSeconds` `0`, so MongoDB deletes documents once `expiresAt` has passed. An existing
index with an expected name but a different key, uniqueness, sparseness, TTL, partial filter or
collation SHALL be dropped and recreated. The legacy index `assets_storage_key_unique` SHALL be
dropped when present.

#### Scenario: Drifted index is rebuilt

- **WHEN** `gifts_public_id_unique` exists without the unique option and migrations run
- **THEN** the index is dropped and recreated as unique

#### Scenario: Legacy asset index removed

- **WHEN** `assets` has an index named `assets_storage_key_unique` and migrations run
- **THEN** that index no longer exists

#### Scenario: Expired idempotency key removed

- **WHEN** an `idempotencyKeys` document's `expiresAt` is in the past
- **THEN** MongoDB's TTL monitor deletes it without application action

#### Scenario: Expired preview token removed

- **WHEN** a `previewTokens` document's `expiresAt` is in the past
- **THEN** MongoDB's TTL monitor deletes it without application action

### Requirement: Idempotent migration with ledger

The system SHALL provide `db:migrate`, which converges the database to the current schema (creating
missing collections with validators, updating validators, reconciling indexes) and then upserts the
ledger document `_id: "core"` in `databaseMigrations` with `version` equal to the current schema
version `7`, `appliedAt` set to now, and `createdAt` set only on first insert. Running it repeatedly
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
- **THEN** both runs succeed, the schema verifies, and the ledger `version` is `7`

#### Scenario: Command failure exits non-zero

- **WHEN** any database command fails, for example because verification detects drift
- **THEN** the process exits with a non-zero status and does not print the success message

### Requirement: Schema verification

The system SHALL provide `db:verify`, which fails without modifying the database when any managed
collection is missing (`Missing MongoDB collection`), a validator differs from its definition
(`MongoDB validator mismatch`), a legacy index remains (`Legacy MongoDB index remains`), an expected
index is missing (`Missing MongoDB index`) or differs in key or options (`MongoDB index mismatch`),
or the ledger version differs from `7` or is missing (`MongoDB schema version mismatch`).

#### Scenario: Schema drift detected

- **WHEN** the ledger document records `version` `1`
- **THEN** `db:verify` fails with `MongoDB schema version mismatch: expected 7, received 1.`

#### Scenario: Database not yet migrated to version 7

- **WHEN** the ledger document records `version` `6`
- **THEN** `db:verify` fails without modifying the database, for example with
  `MongoDB validator mismatch` for `apiRateLimits` or `Missing MongoDB collection` for
  `previewTokens`
- **AND** after `db:migrate` runs, `db:verify` succeeds

#### Scenario: Empty database fails verification

- **WHEN** `db:verify` runs against a database with no collections
- **THEN** it fails with `Missing MongoDB collection`
