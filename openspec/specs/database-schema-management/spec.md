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
`analyticsEvents`, `apiRateLimits`, `assets`, `authRateLimits`, `databaseMigrations`,
`giftPublications`, `giftRevisions`, `gifts`, `idempotencyKeys`, `jobOutbox`, `orders`,
`paymentAttempts`, `previewTokens`, `reactions`, `sessions`, `templateVersions`, `templates`,
`technicalSpikes`, `users`, `verifications`. The migration SHALL manage these collections: `users`,
`sessions`, `accounts`, `verifications`, `authRateLimits`, `apiRateLimits`, `templates`,
`templateVersions`, `gifts`, `giftRevisions`, `assets`, `idempotencyKeys`, `jobOutbox`,
`previewTokens`, `giftPublications`, `analyticsEvents`; `databaseMigrations` SHALL hold the
migration ledger. The names `abuseReports`, `orders`, `paymentAttempts`, `reactions` and
`technicalSpikes` are reserved and are not created or verified by the migration.

#### Scenario: Migration creates managed collections

- **WHEN** migrations run against an empty database
- **THEN** every managed collection exists afterwards, including `previewTokens`,
  `giftPublications` and `analyticsEvents`

#### Scenario: Upgrading a version 6 database

- **WHEN** migrations run against a database whose ledger records version `6`, as when an
  environment skips the version `7` and `8` deployments
- **THEN** `previewTokens`, `giftPublications` and `analyticsEvents` are created with their
  validators and indexes, the `gifts` and `apiRateLimits` validators and the `gifts` indexes are
  updated, the ledger records version `9`, and no document of any collection is changed

#### Scenario: Upgrading a version 7 database

- **WHEN** migrations run against a database whose ledger records version `7`
- **THEN** `giftPublications` and `analyticsEvents` are created with their validators and indexes,
  the `gifts` and `apiRateLimits` validators and the `gifts` indexes are updated, the ledger records
  version `9`, and no document of any collection is changed

#### Scenario: Upgrading a version 8 database

- **WHEN** migrations run against a database whose ledger records version `8`
- **THEN** `analyticsEvents` is created with its validator and indexes, the `apiRateLimits`
  validator is updated, the ledger records version `9`, and no document of any collection is
  changed

### Requirement: JSON-schema validators

The system SHALL apply a `$jsonSchema` validator (allowing additional properties) to `apiRateLimits`,
`templates`, `templateVersions`, `gifts`, `giftRevisions`, `assets`, `idempotencyKeys`,
`jobOutbox`, `previewTokens`, `giftPublications` and `analyticsEvents`, including at least these
constraints:

- `apiRateLimits` requires `_id`, `count` (int >= 1), `scope` (one of `analytics-event`,
  `analytics-event-ip`, `gift-claim`, `gift-create`, `gift-preview`, `gift-publish`, `gift-update`,
  `media-upload`, `public-gift-read`, `public-gift-read-ip`),
  `subjectHash` (64 lowercase hex characters), `expiresAt`, `createdAt`, `updatedAt`;
- `templates` requires `_id`, `currentVersion`, `status` (`draft`, `published`, `retired`),
  `createdAt`, `updatedAt`;
- `templateVersions` requires `_id`, `templateId`, `version`, `status` (`draft`, `published`,
  `retired`), `manifest` (object), `createdAt`, `updatedAt`;
- `gifts` requires `_id`, `publicId`, `ownership`, `content` (object), `revision` (int >= 0),
  `status` (`draft`, `publishing`, `scheduled`, `published`, `paused`, `expired`, `deleting`,
  `deleted`), `createdAt`, `updatedAt`; `ownership` requires `anonymousDraftId`, `claimTokenHash`
  and `ownerId` and MUST be either anonymous (string draft id and claim token hash, null owner) or
  owned (null draft id and claim token hash, string owner); when present, `shareId` MUST be 22
  base64url characters, `publishedAt` MUST be a date, `publishedRevision` MUST be an int >= 0 and
  `expiresAt` MUST be a date; when present, `entitlement` MUST be an object that requires `planId`
  (`free`, `standard`), `planVersion` (int >= 1), `priceVnd` (int >= 0), `maxPhotos` (int >= 1 or
  null), `watermark` (bool), `retentionDays` (int >= 1), `passwordAccess` (bool),
  `scheduledAccess` (bool), `source` (`free`, `internal`, `legacy`) and `grantedAt` (date);
- `giftRevisions` requires `_id`, `giftId`, `revision` (int >= 0), `content` (object), `createdAt`;
- `assets` requires `_id`, `giftId`, `fieldId`, `giftSlot`, `fieldSlot`, `ownerId`,
  `anonymousDraftId`, `sourceKey`, `declaredContentType` (`image/jpeg`, `image/png`, `image/webp`),
  `declaredSizeBytes` (>= 1), `status` (`initiated`, `uploaded`, `processing`, `ready`, `failed`,
  `deleting`, `deleted`), `attempts` (int >= 0), `derivatives` (array), `placeholderDataUrl`,
  `checksumSha256`, `failureCode`, `expiresAt`, `createdAt`, `updatedAt`; when present,
  `detachedAt` MUST be a date or null;
- `idempotencyKeys` requires `_id`, `actorKey`, `giftId`, `scope`, `key`, `requestFingerprint`,
  `expiresAt`, `createdAt`, `updatedAt`, with non-empty `actorKey`, `giftId` and
  `requestFingerprint`;
- `jobOutbox` requires `_id`, `type`, `payload` (object), `status` (`pending`, `processing`,
  `completed`, `failed`), `attempts` (int >= 0), `availableAt`, `deduplicationKey`, `createdAt`,
  `updatedAt`;
- `previewTokens` requires `_id` (the token's SHA-256 hash, 64 lowercase hex characters), `giftId`
  (non-empty string), `expiresAt` (date) and `createdAt` (date);
- `giftPublications` requires `_id` (non-empty string), `giftId` (non-empty string), `shareId` (22
  base64url characters), `revision` (int >= 0), `templateId`, `templateVersion`,
  `artifactContentHash` (64 lowercase hex characters), `content` (object), `assetIds` (array of
  strings), `audioTrackId` (string or null), `publishedAt` (date) and `createdAt` (date);
- `analyticsEvents` requires `_id` (non-empty string), `name` (one of `customization_started`,
  `required_content_completed`, `preview_started`, `publish_clicked`, `gift_published`,
  `gift_open_interaction`, `scene_completed`, `gift_completed`), `giftRef` (43 base64url
  characters), `templateId` (non-empty string), `templateVersion` (non-empty string), `sessionId`
  (string or null), `sceneId` (string or null), `occurredAt` (date) and `expiresAt` (date).

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

#### Scenario: Publish rate-limit scopes accepted

- **WHEN** rate-limit counters with `scope` `gift-publish`, `public-gift-read` and
  `public-gift-read-ip` are written to
  `apiRateLimits`
- **THEN** MongoDB accepts them

#### Scenario: Malformed share id rejected

- **WHEN** a `gifts` document with a `shareId` of 21 characters, or a `giftPublications` document
  without `artifactContentHash`, is written
- **THEN** MongoDB rejects the write with a document validation error

#### Scenario: Malformed publication pointer rejected

- **WHEN** a `gifts` document with `publishedRevision` `-1` or `"7"`, or an `assets` document with
  `detachedAt` `"yesterday"`, is written
- **THEN** MongoDB rejects the write with a document validation error

#### Scenario: Analytics rate-limit scopes accepted

- **WHEN** rate-limit counters with `scope` `analytics-event` and `analytics-event-ip` are written
  to `apiRateLimits`
- **THEN** MongoDB accepts them

#### Scenario: Malformed analytics event rejected

- **WHEN** an `analyticsEvents` document with the `name` `gift_viewed`, or without `expiresAt`, or
  with a 64-character hex `giftRef`, is written
- **THEN** MongoDB rejects the write with a document validation error

#### Scenario: Malformed entitlement rejected

- **WHEN** a `gifts` document with an `entitlement` whose `planId` is `premium`, whose `priceVnd`
  is `"49000"`, or that has no `grantedAt`, or with an `expiresAt` of `"2026-10-22"`, is written
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
  `gifts_status_unlock`, `gifts_status_expiry`, `gifts_share_id_unique` (unique `shareId` where it
  is a string);
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
- `previewTokens`: `preview_tokens_expiry_ttl`;
- `giftPublications`: `gift_publications_gift_revision_unique` (unique `giftId` + `revision`),
  which also serves the lookup of a gift's current publication;
- `analyticsEvents`: `analytics_events_expiry_ttl`, `analytics_events_name_occurred` (`name` +
  `occurredAt`).

The indexes `sessions_expiry_ttl`, `verifications_expiry_ttl`, `api_rate_limits_expiry_ttl`,
`idempotency_expiry_ttl`, `preview_tokens_expiry_ttl` and `analytics_events_expiry_ttl` SHALL be
TTL indexes on `expiresAt` with
`expireAfterSeconds` `0`, so MongoDB deletes documents once `expiresAt` has passed. An existing
index with an expected name but a different key, uniqueness, sparseness, TTL, partial filter or
collation SHALL be dropped and recreated. The legacy indexes `assets_storage_key_unique` and
`gift_publications_share_id_unique` SHALL be dropped when present; the latter would reject the
second publication of a gift, which keeps its share id.

#### Scenario: Drifted index is rebuilt

- **WHEN** `gifts_public_id_unique` exists without the unique option and migrations run
- **THEN** the index is dropped and recreated as unique

#### Scenario: Legacy asset index removed

- **WHEN** `assets` has an index named `assets_storage_key_unique` and migrations run
- **THEN** that index no longer exists

#### Scenario: Legacy publication share id index removed

- **WHEN** `giftPublications` has an index named `gift_publications_share_id_unique` and migrations
  run
- **THEN** that index no longer exists, and two publications of one gift with the same `shareId`
  and different revisions can both be stored

#### Scenario: Expired idempotency key removed

- **WHEN** an `idempotencyKeys` document's `expiresAt` is in the past
- **THEN** MongoDB's TTL monitor deletes it without application action

#### Scenario: Expired preview token removed

- **WHEN** a `previewTokens` document's `expiresAt` is in the past
- **THEN** MongoDB's TTL monitor deletes it without application action

#### Scenario: Drafts share no share id

- **WHEN** many `gifts` documents have no `shareId`
- **THEN** `gifts_share_id_unique` accepts them, and a second document with an existing string
  `shareId` is rejected with a duplicate-key error

#### Scenario: Expired analytics event removed

- **WHEN** an `analyticsEvents` document's `expiresAt` is in the past
- **THEN** MongoDB's TTL monitor deletes it without application action

#### Scenario: Drifted analytics TTL index is rebuilt

- **WHEN** `analytics_events_expiry_ttl` exists without `expireAfterSeconds` and migrations run
- **THEN** the index is dropped and recreated as a TTL index with `expireAfterSeconds` `0`

### Requirement: Idempotent migration with ledger

The system SHALL provide `db:migrate`, which converges the database to the current schema (creating
missing collections with validators, updating validators, reconciling indexes) and then upserts the
ledger document `_id: "core"` in `databaseMigrations` with `version` equal to the current schema
version `11`, `appliedAt` set to now, and `createdAt` set only on first insert. Before writing the
ledger it SHALL run these backfills, in this order:

1. set `publishedRevision` to the gift's `revision` on every `published` gift that has no
   `publishedRevision`. Such gifts were published before editing after publish existed (schema
   version `10`), so their revision is the revision of their only publication;
2. give every `published` gift that has no `entitlement` the entitlement of `standard` version `1`
   of `gift-plans`, with `source` `legacy` and `grantedAt` equal to the gift's `publishedAt`, and
   set its `expiresAt` to `publishedAt` plus 365 days. Such gifts were published under the
   internal publish entitlement, before plans existed (schema version `11`), with up to the
   template's photo limit.

Running it repeatedly SHALL produce the same schema and data without errors. It SHALL print one
JSON line per collection and phase,
`{"collection":<name>,"event":"database_migration","phase":"start"|"complete"}`, and SHALL verify the
schema after migrating.

The `db:migrate`, `db:seed` and `db:verify` commands SHALL read configuration from the environment
and the optional `.env` and `apps/web/.env.local` files, print
`Database command completed successfully.` on success, exit with a non-zero status on any failure,
and always close the MongoDB client before exiting. An unrecognized command MUST fail with
`Expected database command: migrate, seed, or verify.`

#### Scenario: Re-running migrations is safe

- **WHEN** `db:migrate` is run twice against the same database
- **THEN** both runs succeed, the schema verifies, and the ledger `version` is `11`

#### Scenario: Published gifts backfilled

- **WHEN** `db:migrate` runs on a database with a `published` gift at revision `7` that has no
  `publishedRevision`, and a `draft` gift
- **THEN** the published gift's `publishedRevision` is `7`, the draft has no `publishedRevision`,
  and a second run changes nothing

#### Scenario: Legacy published gifts receive an entitlement

- **WHEN** `db:migrate` runs on a database with a `published` gift whose `publishedAt` is
  `2026-10-01T00:00:00Z` and that has no `entitlement`, a published gift that already has a `free`
  entitlement, and a `draft` gift
- **THEN** the first gift's entitlement is `standard` version `1` with `source` `legacy` and
  `grantedAt` `2026-10-01T00:00:00Z`, and its `expiresAt` is `2027-10-01T00:00:00Z`
- **AND** the second gift's entitlement is unchanged, the draft has neither `entitlement` nor
  `expiresAt`, and a second run changes nothing

#### Scenario: Command failure exits non-zero

- **WHEN** any database command fails, for example because verification detects drift
- **THEN** the process exits with a non-zero status and does not print the success message

### Requirement: Schema verification

The system SHALL provide `db:verify`, which fails without modifying the database when any managed
collection is missing (`Missing MongoDB collection`), a validator differs from its definition
(`MongoDB validator mismatch`), a legacy index remains (`Legacy MongoDB index remains`), an expected
index is missing (`Missing MongoDB index`) or differs in key or options (`MongoDB index mismatch`),
or the ledger version differs from `11` or is missing (`MongoDB schema version mismatch`).

#### Scenario: Schema drift detected

- **WHEN** the ledger document records `version` `1`
- **THEN** `db:verify` fails with `MongoDB schema version mismatch: expected 11, received 1.`

#### Scenario: Database not yet migrated to version 7

- **WHEN** the ledger document records `version` `6`, without `previewTokens`
- **THEN** `db:verify` fails without modifying the database, for example with
  `MongoDB validator mismatch` for `apiRateLimits` or `gifts`, or `Missing MongoDB collection` for
  `previewTokens`, `giftPublications` or `analyticsEvents`
- **AND** after `db:migrate` runs, `db:verify` succeeds and the ledger records version `11`

#### Scenario: Database not yet migrated to version 8

- **WHEN** the ledger document records `version` `7`
- **THEN** `db:verify` fails without modifying the database, for example with
  `MongoDB validator mismatch` for `apiRateLimits` or `gifts`, or `Missing MongoDB collection` for
  `giftPublications` or `analyticsEvents`
- **AND** after `db:migrate` runs, `db:verify` succeeds and the ledger records version `11`

#### Scenario: Database not yet migrated to version 9

- **WHEN** the ledger document records `version` `8`
- **THEN** `db:verify` fails without modifying the database, for example with
  `MongoDB validator mismatch` for `apiRateLimits`, or `Missing MongoDB collection` for
  `analyticsEvents`
- **AND** after `db:migrate` runs, `db:verify` succeeds and the ledger records version `11`

#### Scenario: Database not yet migrated to version 10

- **WHEN** the ledger document records `version` `9`
- **THEN** `db:verify` fails without modifying the database, for example with
  `MongoDB validator mismatch` for `gifts` or `assets`, or `Legacy MongoDB index remains` for
  `giftPublications.gift_publications_share_id_unique`
- **AND** after `db:migrate` runs, `db:verify` succeeds and the ledger records version `11`

#### Scenario: Database not yet migrated to version 11

- **WHEN** the ledger document records `version` `10`
- **THEN** `db:verify` fails without modifying the database, with `MongoDB validator mismatch` for
  `gifts` or `MongoDB schema version mismatch: expected 11, received 10.`
- **AND** after `db:migrate` runs, `db:verify` succeeds and the ledger records version `11`

#### Scenario: Empty database fails verification

- **WHEN** `db:verify` runs against a database with no collections
- **THEN** it fails with `Missing MongoDB collection`

### Requirement: Template catalog seed

The system SHALL provide `db:seed`, which runs migrations, then idempotently upserts the built-in
templates (`memory-box` at current version `1.1.0`, with its earlier version `1.0.0` kept as
`retired`; `our-timeline` and `midnight-wish` each at version `1.0.0`; each template with status
`published`, `sortOrder` `0`, `1`, `2` respectively), then verifies the schema. Each `templates`
document SHALL be keyed by the template id with `currentVersion`, `sortOrder`, `status` and
timestamps; each `templateVersions` document SHALL be keyed `<templateId>@<version>` with
`templateId`, `version`, `status`, `manifest`, `previewFixture`, `contentHash` (SHA-256 hex of the
serialized manifest) and timestamps. For documents inserted from now on, `manifest` is the manifest
as authored, and the serialized form is canonical JSON: object keys sorted recursively, no
whitespace, array order kept.

A template's preview fixture MUST validate against its manifest before it is written. `createdAt`
SHALL be preserved on re-seed.

When a `templateVersions` document already exists, `db:seed` SHALL compare the canonical JSON of
its stored `manifest` with the canonical JSON of the seed's manifest; key order MUST NOT matter.
When they differ, `db:seed` MUST fail with an error naming `<templateId>@<version>` and MUST NOT
modify that document. An existing document's `manifest`, `previewFixture` and `contentHash` MUST
stay exactly as first stored; re-seeding only updates its `status` and `updatedAt`.

#### Scenario: Seeding twice keeps one document per template

- **WHEN** `db:seed` is run twice
- **THEN** `templates` contains exactly one document each for `memory-box`, `our-timeline` and `midnight-wish`
- **AND** `templateVersions` contains `memory-box@1.0.0`, `memory-box@1.1.0`, `our-timeline@1.0.0`
  and `midnight-wish@1.0.0`

#### Scenario: Retiring the first Memory Box release

- **WHEN** `db:seed` runs against a database seeded before this change
- **THEN** `memory-box@1.0.0` has status `retired` and the same `contentHash` as before
- **AND** the `memory-box` document has `currentVersion` `1.1.0`

#### Scenario: Stored manifest with a different key order

- **WHEN** `db:seed` finds `memory-box@1.0.0` stored with the same manifest content in a different
  key order
- **THEN** seeding succeeds and the stored `manifest` and `contentHash` are unchanged

#### Scenario: Conflicting stored release

- **WHEN** `db:seed` finds `memory-box@1.1.0` stored with a manifest whose content differs from the
  seed's
- **THEN** the command fails naming `memory-box@1.1.0` and that document is unchanged

### Requirement: Gift persistence verification

The system SHALL provide `db:verify-gifts`, which exercises gift persistence against the configured
database and fails with a non-zero exit status unless all of the following hold: an anonymous draft
created with a `gift-create` idempotency key is returned to its anonymous accessor; a different user
is denied access; an update at expected revision `0` persists revision `1`; a second update at the
stale revision `0` is rejected; the draft can be claimed by a user; replaying the original
anonymous idempotency key after the claim yields a conflict; publishing the claimed draft at its
current revision with a `gift-publish` idempotency key, sent as two concurrent requests that each
generate their own share id, stores exactly one `giftPublications` record, returns the same
`shareId` to both, and sets the gift's status to `published` with that `shareId` and its
`publishedRevision`, and with the granted `free` entitlement and its `expiresAt`; replaying that
publish key returns the same publication; a publish at a stale revision is rejected; the lookup of a
published gift by share id is answered by an index scan of `gifts_share_id_unique` (checked with
`explain`); a save of the published gift's working copy persists the next revision while the
current publication is unchanged; publishing that revision with a new key stores a second
publication with the same `shareId`, switches `publishedRevision`, and leaves the first publication,
the entitlement and `expiresAt` unchanged; the lookup of the current publication by gift id and
revision is answered by an index scan of `gift_publications_gift_revision_unique`; replaying the
first publish key still returns the first publication; publishing the same revision again with
another key is rejected and stores nothing; the share-id lookup at a time after the gift's
`expiresAt` finds nothing, and an update write conditioned on that time is rejected; a `ready` asset
referenced by the current publication is detached and never moved to `deleting`; and, on a second
draft, a publish and a concurrent deletion of its only `ready` asset never both delete the asset and
publish it: either the gift is published with the asset still `ready`, or the asset is `deleting`
with the gift still a `draft`. It SHALL delete the gifts, their revisions, publications, assets and
idempotency keys whether or not verification succeeds, and print
`Gift persistence verification completed successfully.` on success.

#### Scenario: Verification leaves no residue

- **WHEN** `db:verify-gifts` completes, successfully or not
- **THEN** no `gifts`, `giftRevisions`, `giftPublications`, `assets` or `idempotencyKeys` documents
  for the verification gift remain

#### Scenario: Publish transaction verified on a real replica set

- **WHEN** `db:verify-gifts` runs against a MongoDB replica set with the current schema
- **THEN** the publish, its replay, the stale-revision rejection, the indexed share-id lookup, the
  update to a second publication under the same share id, the indexed current-publication lookup,
  the kept entitlement, the expired lookup and the detached asset behave as specified, and the
  command prints `Gift persistence verification completed successfully.`

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
