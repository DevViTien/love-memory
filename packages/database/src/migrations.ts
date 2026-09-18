import "server-only";

import { isDeepStrictEqual } from "node:util";
import {
  type CreateIndexesOptions,
  type Db,
  type Document,
  type IndexSpecification,
} from "mongodb";

import { COLLECTIONS, type CollectionName } from "./collections";

export const DATABASE_SCHEMA_VERSION = 6;

type DatabaseMigrationDocument = Readonly<{
  _id: string;
  appliedAt: Date;
  createdAt: Date;
  version: number;
}>;

type IndexDefinition = Readonly<{
  key: IndexSpecification;
  options: CreateIndexesOptions & Readonly<{ name: string }>;
}>;

type CollectionDefinition = Readonly<{
  indexes: readonly IndexDefinition[];
  name: CollectionName;
  validator?: Document;
}>;

type ExistingIndex = Readonly<{
  collation?: Document;
  expireAfterSeconds?: number;
  key: Document;
  name?: string;
  partialFilterExpression?: Document;
  sparse?: boolean;
  unique?: boolean;
}>;

const timestampsValidator = {
  createdAt: { bsonType: "date" },
  updatedAt: { bsonType: "date" },
} as const;

const LEGACY_INDEX_NAMES: Readonly<Partial<Record<CollectionName, readonly string[]>>> = {
  [COLLECTIONS.assets]: ["assets_storage_key_unique"],
};

export const CORE_COLLECTION_DEFINITIONS: readonly CollectionDefinition[] = [
  {
    indexes: [{ key: { email: 1 }, options: { name: "users_email_unique", unique: true } }],
    name: COLLECTIONS.users,
  },
  {
    indexes: [
      { key: { token: 1 }, options: { name: "sessions_token_unique", unique: true } },
      { key: { userId: 1, expiresAt: -1 }, options: { name: "sessions_user_expiry" } },
      {
        key: { expiresAt: 1 },
        options: { expireAfterSeconds: 0, name: "sessions_expiry_ttl" },
      },
    ],
    name: COLLECTIONS.sessions,
  },
  {
    indexes: [
      {
        key: { providerId: 1, accountId: 1 },
        options: { name: "accounts_provider_account_unique", unique: true },
      },
      { key: { userId: 1 }, options: { name: "accounts_user" } },
    ],
    name: COLLECTIONS.accounts,
  },
  {
    indexes: [
      { key: { identifier: 1 }, options: { name: "verifications_identifier" } },
      {
        key: { expiresAt: 1 },
        options: { expireAfterSeconds: 0, name: "verifications_expiry_ttl" },
      },
    ],
    name: COLLECTIONS.verifications,
  },
  {
    indexes: [{ key: { key: 1 }, options: { name: "auth_rate_limits_key_unique", unique: true } }],
    name: COLLECTIONS.authRateLimits,
  },
  {
    indexes: [
      {
        key: { expiresAt: 1 },
        options: { expireAfterSeconds: 0, name: "api_rate_limits_expiry_ttl" },
      },
    ],
    name: COLLECTIONS.apiRateLimits,
    validator: {
      $jsonSchema: {
        additionalProperties: true,
        bsonType: "object",
        properties: {
          _id: { bsonType: "string" },
          count: { bsonType: "int", minimum: 1 },
          expiresAt: { bsonType: "date" },
          scope: { enum: ["gift-claim", "gift-create", "gift-update", "media-upload"] },
          subjectHash: { bsonType: "string", pattern: "^[a-f0-9]{64}$" },
          ...timestampsValidator,
        },
        required: ["_id", "count", "scope", "subjectHash", "expiresAt", "createdAt", "updatedAt"],
      },
    },
  },
  {
    indexes: [{ key: { status: 1, sortOrder: 1 }, options: { name: "templates_status_order" } }],
    name: COLLECTIONS.templates,
    validator: {
      $jsonSchema: {
        additionalProperties: true,
        bsonType: "object",
        properties: {
          _id: { bsonType: "string" },
          currentVersion: { bsonType: "string" },
          status: { enum: ["draft", "published", "retired"] },
          ...timestampsValidator,
        },
        required: ["_id", "currentVersion", "status", "createdAt", "updatedAt"],
      },
    },
  },
  {
    indexes: [
      {
        key: { templateId: 1, version: 1 },
        options: { name: "template_versions_identity_unique", unique: true },
      },
      { key: { status: 1, templateId: 1 }, options: { name: "template_versions_status" } },
    ],
    name: COLLECTIONS.templateVersions,
    validator: {
      $jsonSchema: {
        additionalProperties: true,
        bsonType: "object",
        properties: {
          _id: { bsonType: "string" },
          manifest: { bsonType: "object" },
          status: { enum: ["draft", "published", "retired"] },
          templateId: { bsonType: "string" },
          version: { bsonType: "string" },
          ...timestampsValidator,
        },
        required: ["_id", "templateId", "version", "status", "manifest", "createdAt", "updatedAt"],
      },
    },
  },
  {
    indexes: [
      { key: { publicId: 1 }, options: { name: "gifts_public_id_unique", unique: true } },
      {
        key: { "ownership.ownerId": 1, updatedAt: -1 },
        options: { name: "gifts_owner_updated" },
      },
      { key: { status: 1, "access.unlockAt": 1 }, options: { name: "gifts_status_unlock" } },
      { key: { status: 1, expiresAt: 1 }, options: { name: "gifts_status_expiry" } },
    ],
    name: COLLECTIONS.gifts,
    validator: {
      $jsonSchema: {
        additionalProperties: true,
        bsonType: "object",
        properties: {
          _id: { bsonType: "string" },
          content: { bsonType: "object" },
          ownership: {
            bsonType: "object",
            oneOf: [
              {
                properties: {
                  anonymousDraftId: { bsonType: "string" },
                  claimTokenHash: { bsonType: "string" },
                  ownerId: { bsonType: "null" },
                },
              },
              {
                properties: {
                  anonymousDraftId: { bsonType: "null" },
                  claimTokenHash: { bsonType: "null" },
                  ownerId: { bsonType: "string" },
                },
              },
            ],
            required: ["anonymousDraftId", "claimTokenHash", "ownerId"],
          },
          publicId: { bsonType: "string" },
          revision: { bsonType: "int", minimum: 0 },
          status: {
            enum: [
              "draft",
              "publishing",
              "scheduled",
              "published",
              "paused",
              "expired",
              "deleting",
              "deleted",
            ],
          },
          ...timestampsValidator,
        },
        required: [
          "_id",
          "publicId",
          "ownership",
          "content",
          "revision",
          "status",
          "createdAt",
          "updatedAt",
        ],
      },
    },
  },
  {
    indexes: [
      {
        key: { giftId: 1, revision: 1 },
        options: { name: "gift_revisions_identity_unique", unique: true },
      },
      { key: { giftId: 1, createdAt: -1 }, options: { name: "gift_revisions_history" } },
    ],
    name: COLLECTIONS.giftRevisions,
    validator: {
      $jsonSchema: {
        additionalProperties: true,
        bsonType: "object",
        properties: {
          _id: { bsonType: "string" },
          content: { bsonType: "object" },
          createdAt: { bsonType: "date" },
          giftId: { bsonType: "string" },
          revision: { bsonType: "int", minimum: 0 },
        },
        required: ["_id", "giftId", "revision", "content", "createdAt"],
      },
    },
  },
  {
    indexes: [
      {
        key: { sourceKey: 1 },
        options: {
          name: "assets_source_key_unique",
          partialFilterExpression: { sourceKey: { $type: "string" } },
          unique: true,
        },
      },
      {
        key: { ownerId: 1, status: 1, createdAt: -1 },
        options: { name: "assets_owner_status_created" },
      },
      {
        key: { anonymousDraftId: 1, status: 1, createdAt: -1 },
        options: { name: "assets_anonymous_status_created" },
      },
      {
        key: { giftId: 1, fieldId: 1, createdAt: 1 },
        options: { name: "assets_gift_field_created" },
      },
      {
        key: { giftId: 1, giftSlot: 1 },
        options: {
          name: "assets_active_gift_slot_unique",
          partialFilterExpression: {
            giftSlot: { $type: "number" },
            status: {
              $in: ["initiated", "uploaded", "processing", "ready", "failed", "deleting"],
            },
          },
          unique: true,
        },
      },
      {
        key: { giftId: 1, fieldId: 1, fieldSlot: 1 },
        options: {
          name: "assets_active_field_slot_unique",
          partialFilterExpression: {
            fieldSlot: { $type: "number" },
            status: {
              $in: ["initiated", "uploaded", "processing", "ready", "failed", "deleting"],
            },
          },
          unique: true,
        },
      },
      { key: { status: 1, expiresAt: 1 }, options: { name: "assets_status_expiry" } },
    ],
    name: COLLECTIONS.assets,
    validator: {
      $jsonSchema: {
        additionalProperties: true,
        bsonType: "object",
        properties: {
          _id: { bsonType: "string" },
          anonymousDraftId: { bsonType: ["string", "null"] },
          attempts: { bsonType: "int", minimum: 0 },
          checksumSha256: { bsonType: ["string", "null"] },
          declaredContentType: { enum: ["image/jpeg", "image/png", "image/webp"] },
          declaredSizeBytes: { bsonType: ["int", "long"], minimum: 1 },
          derivatives: { bsonType: "array" },
          expiresAt: { bsonType: ["date", "null"] },
          failureCode: { bsonType: ["string", "null"] },
          fieldId: { bsonType: "string" },
          fieldSlot: { bsonType: ["int", "long", "null"], minimum: 0 },
          giftId: { bsonType: "string" },
          giftSlot: { bsonType: ["int", "long", "null"], minimum: 0 },
          ownerId: { bsonType: ["string", "null"] },
          placeholderDataUrl: { bsonType: ["string", "null"] },
          status: {
            enum: ["initiated", "uploaded", "processing", "ready", "failed", "deleting", "deleted"],
          },
          sourceKey: { bsonType: "string" },
          ...timestampsValidator,
        },
        required: [
          "_id",
          "giftId",
          "fieldId",
          "giftSlot",
          "fieldSlot",
          "ownerId",
          "anonymousDraftId",
          "sourceKey",
          "declaredContentType",
          "declaredSizeBytes",
          "status",
          "attempts",
          "derivatives",
          "placeholderDataUrl",
          "checksumSha256",
          "failureCode",
          "expiresAt",
          "createdAt",
          "updatedAt",
        ],
      },
    },
  },
  {
    indexes: [
      {
        key: { scope: 1, key: 1 },
        options: { name: "idempotency_scope_key_unique", unique: true },
      },
      {
        key: { expiresAt: 1 },
        options: { expireAfterSeconds: 0, name: "idempotency_expiry_ttl" },
      },
    ],
    name: COLLECTIONS.idempotencyKeys,
    validator: {
      $jsonSchema: {
        additionalProperties: true,
        bsonType: "object",
        properties: {
          _id: { bsonType: "string" },
          actorKey: { bsonType: "string", minLength: 1 },
          expiresAt: { bsonType: "date" },
          giftId: { bsonType: "string", minLength: 1 },
          key: { bsonType: "string" },
          requestFingerprint: { bsonType: "string", minLength: 1 },
          scope: { bsonType: "string" },
          ...timestampsValidator,
        },
        required: [
          "_id",
          "actorKey",
          "giftId",
          "scope",
          "key",
          "requestFingerprint",
          "expiresAt",
          "createdAt",
          "updatedAt",
        ],
      },
    },
  },
  {
    indexes: [
      { key: { status: 1, availableAt: 1 }, options: { name: "job_outbox_available" } },
      { key: { deduplicationKey: 1 }, options: { name: "job_outbox_deduplication", unique: true } },
    ],
    name: COLLECTIONS.jobOutbox,
    validator: {
      $jsonSchema: {
        additionalProperties: true,
        bsonType: "object",
        properties: {
          _id: { bsonType: "string" },
          attempts: { bsonType: "int", minimum: 0 },
          availableAt: { bsonType: "date" },
          deduplicationKey: { bsonType: "string" },
          payload: { bsonType: "object" },
          status: { enum: ["pending", "processing", "completed", "failed"] },
          type: { bsonType: "string" },
          ...timestampsValidator,
        },
        required: [
          "_id",
          "type",
          "payload",
          "status",
          "attempts",
          "availableAt",
          "deduplicationKey",
          "createdAt",
          "updatedAt",
        ],
      },
    },
  },
] as const;

function indexMatches(existing: ExistingIndex, expected: IndexDefinition): boolean {
  return (
    isDeepStrictEqual(existing.key, expected.key) &&
    Boolean(existing.unique) === Boolean(expected.options.unique) &&
    Boolean(existing.sparse) === Boolean(expected.options.sparse) &&
    isDeepStrictEqual(existing.expireAfterSeconds, expected.options.expireAfterSeconds) &&
    isDeepStrictEqual(existing.partialFilterExpression, expected.options.partialFilterExpression) &&
    isDeepStrictEqual(existing.collation, expected.options.collation)
  );
}

async function ensureCollection(database: Db, definition: CollectionDefinition): Promise<void> {
  const exists = await database
    .listCollections({ name: definition.name }, { nameOnly: true })
    .hasNext();

  if (!exists) {
    await database.createCollection(definition.name, {
      ...(definition.validator ? { validator: definition.validator } : {}),
    });
  } else if (definition.validator) {
    await database.command({ collMod: definition.name, validator: definition.validator });
  }

  if (definition.indexes.length > 0) {
    const collection = database.collection(definition.name);
    const existingIndexes = await collection.indexes();
    for (const legacyName of LEGACY_INDEX_NAMES[definition.name] ?? []) {
      if (existingIndexes.some((candidate) => candidate.name === legacyName)) {
        await collection.dropIndex(legacyName);
      }
    }
    for (const index of definition.indexes) {
      const existing = existingIndexes.find((candidate) => candidate.name === index.options.name);
      if (existing && !indexMatches(existing, index)) {
        await collection.dropIndex(index.options.name);
      }
      await collection.createIndex(index.key, index.options);
    }
  }
}

export async function runDatabaseMigrations(
  database: Db,
  onProgress: (collection: CollectionName, phase: "complete" | "start") => void = () => undefined,
): Promise<void> {
  for (const definition of CORE_COLLECTION_DEFINITIONS) {
    onProgress(definition.name, "start");
    await ensureCollection(database, definition);
    onProgress(definition.name, "complete");
  }

  await database.collection<DatabaseMigrationDocument>(COLLECTIONS.databaseMigrations).updateOne(
    { _id: "core" },
    {
      $set: { appliedAt: new Date(), version: DATABASE_SCHEMA_VERSION },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
}

export async function verifyDatabaseSchema(database: Db): Promise<void> {
  for (const definition of CORE_COLLECTION_DEFINITIONS) {
    const collectionInfo = await database
      .listCollections({ name: definition.name }, { nameOnly: false })
      .next();

    if (!collectionInfo) {
      throw new Error(`Missing MongoDB collection: ${definition.name}`);
    }

    if (
      definition.validator &&
      !isDeepStrictEqual(collectionInfo.options?.["validator"], definition.validator)
    ) {
      throw new Error(`MongoDB validator mismatch: ${definition.name}`);
    }

    const existingIndexes = await database.collection(definition.name).indexes();

    for (const legacyName of LEGACY_INDEX_NAMES[definition.name] ?? []) {
      if (existingIndexes.some((candidate) => candidate.name === legacyName)) {
        throw new Error(`Legacy MongoDB index remains: ${definition.name}.${legacyName}`);
      }
    }

    for (const index of definition.indexes) {
      const existing = existingIndexes.find((candidate) => candidate.name === index.options.name);
      if (!existing) {
        throw new Error(`Missing MongoDB index: ${definition.name}.${index.options.name}`);
      }
      if (!indexMatches(existing, index)) {
        throw new Error(`MongoDB index mismatch: ${definition.name}.${index.options.name}`);
      }
    }
  }

  const migration = await database
    .collection<DatabaseMigrationDocument>(COLLECTIONS.databaseMigrations)
    .findOne({ _id: "core" });
  if (migration?.version !== DATABASE_SCHEMA_VERSION) {
    throw new Error(
      `MongoDB schema version mismatch: expected ${DATABASE_SCHEMA_VERSION}, received ${migration?.version ?? "missing"}.`,
    );
  }
}
