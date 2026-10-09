# Spec Delta

## MODIFIED Requirements

### Requirement: JSON-schema validators

The system SHALL apply a `$jsonSchema` validator (allowing additional properties) to `apiRateLimits`,
`templates`, `templateVersions`, `gifts`, `giftRevisions`, `assets`, `idempotencyKeys`,
`jobOutbox`, `previewTokens`, `giftPublications`, `analyticsEvents`, `adminStepUps`, `auditLog`,
`giftTombstones` and `abuseReports`, including at least these constraints:

- `apiRateLimits` requires `_id`, `count` (int >= 1), `scope` (one of `abuse-report`,
  `abuse-report-ip`, `admin-action`, `admin-mfa`, `analytics-event`, `analytics-event-ip`,
  `gift-claim`, `gift-create`, `gift-lifecycle`, `gift-preview`, `gift-publish`, `gift-read`,
  `gift-update`, `media-read`, `media-upload`, `media-write`, `public-gift-read`,
  `public-gift-read-ip`),
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
  `completed`, `failed`, `dead`), `attempts` (int >= 0), `availableAt`, `deduplicationKey`,
  `createdAt`, `updatedAt`; when present, `lastErrorCode` MUST be a string or null;
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

- `adminStepUps` requires `_id` (the SHA-256 hash of the session id, 64 lowercase hex characters),
  `userId` (non-empty string), `verifiedAt` (date) and `expiresAt` (date);
- `auditLog` requires `_id` (non-empty string), `at` (date), `actor` (object with `kind` one of
  `admin`, `operator`, `system`, and a non-empty `id`), `action` (non-empty string), `target`
  (object or null), `requestId` (string or null), `metadata` (object) and `expiresAt` (date);
- `giftTombstones` requires `_id` (non-empty string), `publicId` (string), `ownerId` (string or
  null), `createdAt` (date), `publishedAt` (date or null), `deletionRequestedAt` (date),
  `deletedAt` (date) and `expiresAt` (date);
- `abuseReports` requires `_id` (non-empty string), `giftId` (non-empty string), `category` (one of
  `child_safety`, `self_harm`, `violence`, `sexual`, `illegal`, `harassment`, `spam`, `other`),
  `severity` (`critical`, `high` or `normal`), `severityRank` (int 0–2), `details` (string of at
  most 1000 characters, or null), `status` (`open`, `actioned` or `dismissed`), `createdAt`,
  `updatedAt` and `expiresAt` (dates).

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

#### Scenario: Dead-letter job accepted

- **WHEN** a `jobOutbox` document with `status` `dead` and `lastErrorCode` `JOB_FAILED` is written
- **THEN** MongoDB accepts it, and a document with `status` `abandoned` or a numeric
  `lastErrorCode` is rejected with a document validation error

#### Scenario: Admin step-up and audit records validated

- **WHEN** an `adminStepUps` document without `expiresAt`, or an `auditLog` document whose actor
  kind is `creator`, is written
- **THEN** MongoDB rejects the write with a document validation error

#### Scenario: Tombstone without a deletion time rejected

- **WHEN** a `giftTombstones` document without `deletedAt` is written
- **THEN** MongoDB rejects the write with a document validation error

#### Scenario: Report with an unknown category rejected

- **WHEN** an `abuseReports` document with the category `rude` is written
- **THEN** MongoDB rejects the write with a document validation error

### Requirement: Idempotent migration with ledger

The system SHALL provide `db:migrate`, which converges the database to the current schema (creating
missing collections with validators, updating validators, reconciling indexes) and then upserts the
ledger document `_id: "core"` in `databaseMigrations` with `version` equal to the current schema
version `16`, `appliedAt` set to now, and `createdAt` set only on first insert. Before writing the
ledger it SHALL run these backfills, in this order:

1. set `publishedRevision` to the gift's `revision` on every `published` gift that has no
   `publishedRevision`. Such gifts were published before editing after publish existed (schema
   version `10`), so their revision is the revision of their only publication;
2. give every `published` gift that has no `entitlement` the entitlement of `standard` version `1`
   of `gift-plans`, with `source` `legacy` and `grantedAt` equal to the gift's `publishedAt`, and
   set its `expiresAt` to `publishedAt` plus 365 days. Such gifts were published under the
   internal publish entitlement, before plans existed (schema version `11`), with up to the
   template's photo limit;
3. enqueue, for every `published` gift that has at least one detached `ready` asset, one
   `gift.assets.cleanup.v1` job (`media-upload` "Cleanup of detached assets") with the deduplication
   key `gift.assets.cleanup.v1:{giftId}:{publishedRevision}`, inserting nothing when that key
   already exists. Such assets were detached before the cleanup job existed (schema version `12`).

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
- **THEN** both runs succeed, the schema verifies, and the ledger `version` is `16`

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

#### Scenario: Cleanup jobs backfilled for detached photos

- **WHEN** `db:migrate` runs on a database with a `published` gift at `publishedRevision` `7` that has
  a detached `ready` asset, and another published gift without detached assets
- **THEN** exactly one `pending` `gift.assets.cleanup.v1` job exists, for the first gift, with the
  deduplication key `gift.assets.cleanup.v1:{giftId}:7`, and a second run adds no job

### Requirement: Schema verification

The system SHALL provide `db:verify`, which fails without modifying the database when any managed
collection is missing (`Missing MongoDB collection`), a validator differs from its definition
(`MongoDB validator mismatch`), a legacy index remains (`Legacy MongoDB index remains`), an expected
index is missing (`Missing MongoDB index`) or differs in key or options (`MongoDB index mismatch`),
or the ledger version differs from `16` or is missing (`MongoDB schema version mismatch`).

#### Scenario: Schema drift detected

- **WHEN** the ledger document records `version` `1`
- **THEN** `db:verify` fails with `MongoDB schema version mismatch: expected 16, received 1.`

#### Scenario: Database not yet migrated to version 7

- **WHEN** the ledger document records `version` `6`, without `previewTokens`
- **THEN** `db:verify` fails without modifying the database, for example with
  `MongoDB validator mismatch` for `apiRateLimits` or `gifts`, or `Missing MongoDB collection` for
  `previewTokens`, `giftPublications` or `analyticsEvents`
- **AND** after `db:migrate` runs, `db:verify` succeeds and the ledger records version `16`

#### Scenario: Database not yet migrated to version 8

- **WHEN** the ledger document records `version` `7`
- **THEN** `db:verify` fails without modifying the database, for example with
  `MongoDB validator mismatch` for `apiRateLimits` or `gifts`, or `Missing MongoDB collection` for
  `giftPublications` or `analyticsEvents`
- **AND** after `db:migrate` runs, `db:verify` succeeds and the ledger records version `16`

#### Scenario: Database not yet migrated to version 9

- **WHEN** the ledger document records `version` `8`
- **THEN** `db:verify` fails without modifying the database, for example with
  `MongoDB validator mismatch` for `apiRateLimits`, or `Missing MongoDB collection` for
  `analyticsEvents`
- **AND** after `db:migrate` runs, `db:verify` succeeds and the ledger records version `16`

#### Scenario: Database not yet migrated to version 10

- **WHEN** the ledger document records `version` `9`
- **THEN** `db:verify` fails without modifying the database, for example with
  `MongoDB validator mismatch` for `gifts` or `assets`, or `Legacy MongoDB index remains` for
  `giftPublications.gift_publications_share_id_unique`
- **AND** after `db:migrate` runs, `db:verify` succeeds and the ledger records version `16`

#### Scenario: Database not yet migrated to version 11

- **WHEN** the ledger document records `version` `10`
- **THEN** `db:verify` fails without modifying the database, with `MongoDB validator mismatch` for
  `gifts` or `MongoDB schema version mismatch: expected 11, received 10.`
- **AND** after `db:migrate` runs, `db:verify` succeeds and the ledger records version `16`

#### Scenario: Database not yet migrated to version 12

- **WHEN** the ledger document records `version` `11`
- **THEN** `db:verify` fails without modifying the database, with `MongoDB validator mismatch` for
  `jobOutbox` or `MongoDB schema version mismatch: expected 12, received 11.`
- **AND** after `db:migrate` runs, `db:verify` succeeds and the ledger records version `16`

#### Scenario: Database not yet migrated to version 13

- **WHEN** the ledger document records `version` `12`
- **THEN** `db:verify` fails without modifying the database, for example with
  `Missing MongoDB collection` for `twoFactors`, `adminStepUps` or `auditLog`, or
  `MongoDB validator mismatch` for `apiRateLimits`
- **AND** after `db:migrate` runs, `db:verify` succeeds and the ledger records version `16`

#### Scenario: Empty database fails verification

- **WHEN** `db:verify` runs against a database with no collections
- **THEN** it fails with `Missing MongoDB collection`

#### Scenario: Database not yet migrated to version 14

- **WHEN** the ledger document records `version` `13`
- **THEN** `db:verify` fails without modifying the database, for example with
  `Missing MongoDB collection` for `giftTombstones`, or `MongoDB validator mismatch` for
  `apiRateLimits`
- **AND** after `db:migrate` runs, `db:verify` succeeds and the ledger records version `16`

#### Scenario: Database not yet migrated to version 15

- **WHEN** the ledger document records `version` `14`
- **THEN** `db:verify` fails without modifying the database, for example with
  `Missing MongoDB collection` for `abuseReports`, or `MongoDB validator mismatch` for
  `apiRateLimits`
- **AND** after `db:migrate` runs, `db:verify` succeeds and the ledger records version `16`

#### Scenario: Database not yet migrated to version 16

- **WHEN** the ledger document records `version` `15`
- **THEN** `db:verify` fails without modifying the database, for example with
  `MongoDB validator mismatch` for `apiRateLimits`
- **AND** after `db:migrate` runs, `db:verify` succeeds and the ledger records version `16`
