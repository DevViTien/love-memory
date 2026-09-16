import "server-only";

import {
  type CreateIndexesOptions,
  type Db,
  type Document,
  type IndexSpecification,
} from "mongodb";

import { COLLECTIONS, type CollectionName } from "./collections";

export const DATABASE_SCHEMA_VERSION = 1;

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

const timestampsValidator = {
  createdAt: { bsonType: "date" },
  updatedAt: { bsonType: "date" },
} as const;

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
      { key: { status: 1, unlockAt: 1 }, options: { name: "gifts_status_unlock" } },
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
          ownership: { bsonType: "object" },
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
      { key: { storageKey: 1 }, options: { name: "assets_storage_key_unique", unique: true } },
      {
        key: { ownerId: 1, status: 1, createdAt: -1 },
        options: { name: "assets_owner_status_created" },
      },
    ],
    name: COLLECTIONS.assets,
    validator: {
      $jsonSchema: {
        additionalProperties: true,
        bsonType: "object",
        properties: {
          _id: { bsonType: "string" },
          anonymousDraftId: { bsonType: ["string", "null"] },
          ownerId: { bsonType: ["string", "null"] },
          status: {
            enum: ["initiated", "uploaded", "processing", "ready", "failed", "deleting", "deleted"],
          },
          storageKey: { bsonType: "string" },
          ...timestampsValidator,
        },
        required: ["_id", "storageKey", "status", "createdAt", "updatedAt"],
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
          expiresAt: { bsonType: "date" },
          key: { bsonType: "string" },
          scope: { bsonType: "string" },
          ...timestampsValidator,
        },
        required: ["_id", "scope", "key", "expiresAt", "createdAt", "updatedAt"],
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
    for (const index of definition.indexes) {
      await collection.createIndex(index.key, index.options);
    }
  }
}

export async function runDatabaseMigrations(database: Db): Promise<void> {
  for (const definition of CORE_COLLECTION_DEFINITIONS) {
    await ensureCollection(database, definition);
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
    const exists = await database
      .listCollections({ name: definition.name }, { nameOnly: true })
      .hasNext();

    if (!exists) {
      throw new Error(`Missing MongoDB collection: ${definition.name}`);
    }

    const existingIndexNames = new Set(
      (await database.collection(definition.name).indexes()).map((index) => index.name),
    );

    for (const index of definition.indexes) {
      if (!existingIndexNames.has(index.options.name)) {
        throw new Error(`Missing MongoDB index: ${definition.name}.${index.options.name}`);
      }
    }
  }
}
