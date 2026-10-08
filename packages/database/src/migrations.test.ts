import { type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";

import { COLLECTIONS } from "./collections";
import {
  CORE_COLLECTION_DEFINITIONS,
  DATABASE_SCHEMA_VERSION,
  runDatabaseMigrations,
  verifyDatabaseSchema,
} from "./migrations";

class FakeCollection {
  readonly indexDefinitions: Array<Readonly<Record<string, unknown>>> = [
    { key: { _id: 1 }, name: "_id_" },
  ];
  migrationVersion: number | undefined;
  /** Documents for the data steps; only the operators those steps use are understood. */
  readonly documents: Array<Record<string, unknown>> = [];
  readonly updateMany = vi.fn(
    (
      filter: Readonly<Record<string, unknown>>,
      pipeline: ReadonlyArray<Readonly<{ $set: Readonly<Record<string, string>> }>>,
    ) => {
      const matches = (document: Record<string, unknown>) =>
        Object.entries(filter).every(([key, condition]) =>
          typeof condition === "object" && condition !== null && "$exists" in condition
            ? key in document === (condition as { $exists: boolean }).$exists
            : document[key] === condition,
        );
      let modifiedCount = 0;
      for (const document of this.documents.filter(matches)) {
        for (const stage of pipeline) {
          for (const [key, source] of Object.entries(stage.$set)) {
            document[key] = document[source.slice(1)];
          }
        }
        modifiedCount += 1;
      }
      return Promise.resolve({ modifiedCount });
    },
  );
  readonly updateOne = vi.fn(
    (_filter: unknown, update: Readonly<{ $set?: Readonly<{ version?: number }> }>) => {
      this.migrationVersion = update.$set?.version;
      return Promise.resolve();
    },
  );

  createIndex(key: unknown, options: Readonly<Record<string, unknown> & { name: string }>) {
    const existing = this.indexDefinitions.findIndex((index) => index["name"] === options.name);
    const definition = { key, ...options };
    if (existing === -1) {
      this.indexDefinitions.push(definition);
    } else {
      this.indexDefinitions[existing] = definition;
    }
    return Promise.resolve(options.name);
  }

  dropIndex(name: string) {
    const index = this.indexDefinitions.findIndex((candidate) => candidate["name"] === name);
    if (index !== -1) {
      this.indexDefinitions.splice(index, 1);
    }
    return Promise.resolve();
  }

  findOne() {
    return Promise.resolve(
      this.migrationVersion === undefined ? null : { _id: "core", version: this.migrationVersion },
    );
  }

  indexes() {
    return Promise.resolve(this.indexDefinitions);
  }
}

class FakeDatabase {
  readonly collections = new Map<string, FakeCollection>();
  readonly validators = new Map<string, unknown>();
  readonly command = vi.fn((command: Readonly<{ collMod?: string; validator?: unknown }>) => {
    if (command.collMod && command.validator) {
      this.validators.set(command.collMod, command.validator);
    }
    return Promise.resolve({ ok: 1 });
  });

  collection(name: string) {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new FakeCollection();
      this.collections.set(name, collection);
    }
    return collection;
  }

  createCollection(name: string, options?: Readonly<{ validator?: unknown }>) {
    const collection = this.collection(name);
    if (options?.validator) {
      this.validators.set(name, options.validator);
    }
    return Promise.resolve(collection);
  }

  listCollections(filter: Readonly<{ name: string }>) {
    return {
      hasNext: () => Promise.resolve(this.collections.has(filter.name)),
      next: () =>
        Promise.resolve(
          this.collections.has(filter.name)
            ? { name: filter.name, options: { validator: this.validators.get(filter.name) } }
            : null,
        ),
    };
  }
}

describe("database schema migration", () => {
  it("covers every Sprint 1 collection with stable named indexes", () => {
    const definitions = new Map(
      CORE_COLLECTION_DEFINITIONS.map((definition) => [definition.name, definition]),
    );

    expect(DATABASE_SCHEMA_VERSION).toBe(10);
    expect(definitions.has(COLLECTIONS.users)).toBe(true);
    expect(definitions.has(COLLECTIONS.apiRateLimits)).toBe(true);
    expect(definitions.has(COLLECTIONS.templates)).toBe(true);
    expect(definitions.has(COLLECTIONS.templateVersions)).toBe(true);
    expect(definitions.has(COLLECTIONS.gifts)).toBe(true);
    expect(definitions.has(COLLECTIONS.giftRevisions)).toBe(true);
    expect(definitions.has(COLLECTIONS.assets)).toBe(true);
    expect(definitions.has(COLLECTIONS.idempotencyKeys)).toBe(true);
    expect(definitions.has(COLLECTIONS.jobOutbox)).toBe(true);
    expect(definitions.has(COLLECTIONS.giftPublications)).toBe(true);
    expect(definitions.has(COLLECTIONS.analyticsEvents)).toBe(true);

    const idempotencyValidator = definitions.get(COLLECTIONS.idempotencyKeys)?.validator as
      { $jsonSchema?: { required?: string[] } } | undefined;
    expect(idempotencyValidator?.$jsonSchema?.required).toEqual(
      expect.arrayContaining(["actorKey", "giftId", "requestFingerprint"]),
    );

    const names = CORE_COLLECTION_DEFINITIONS.flatMap((definition) =>
      definition.indexes.map((index) => index.options.name),
    );
    expect(names.every(Boolean)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining(["assets_active_gift_slot_unique", "assets_active_field_slot_unique"]),
    );
  });

  it("stores preview tokens only as hashes and expires them with a TTL index", () => {
    const previewTokens = CORE_COLLECTION_DEFINITIONS.find(
      (definition) => definition.name === COLLECTIONS.previewTokens,
    );
    const schema = (
      previewTokens?.validator as
        | {
            $jsonSchema: {
              properties: Record<string, Record<string, unknown>>;
              required: string[];
            };
          }
        | undefined
    )?.$jsonSchema;

    expect(schema?.required).toEqual(["_id", "giftId", "expiresAt", "createdAt"]);
    expect(schema?.properties["_id"]).toEqual({ bsonType: "string", pattern: "^[a-f0-9]{64}$" });
    expect(schema?.properties["giftId"]).toEqual({ bsonType: "string", minLength: 1 });
    expect(previewTokens?.indexes).toEqual([
      {
        key: { expiresAt: 1 },
        options: { expireAfterSeconds: 0, name: "preview_tokens_expiry_ttl" },
      },
    ]);

    const hashPattern = new RegExp(String(schema?.properties["_id"]?.["pattern"]));
    expect(hashPattern.test("a".repeat(64))).toBe(true);
    expect(hashPattern.test("A-_b".repeat(10) + "xyz")).toBe(false);
  });

  it("accepts the preview, publish, public read and analytics rate-limit scopes", () => {
    const apiRateLimits = CORE_COLLECTION_DEFINITIONS.find(
      (definition) => definition.name === COLLECTIONS.apiRateLimits,
    );
    const scope = (
      apiRateLimits?.validator as
        { $jsonSchema: { properties: { scope: { enum: string[] } } } } | undefined
    )?.$jsonSchema.properties.scope.enum;

    expect(scope).toEqual([
      "analytics-event",
      "analytics-event-ip",
      "gift-claim",
      "gift-create",
      "gift-preview",
      "gift-publish",
      "gift-update",
      "media-upload",
      "public-gift-read",
      "public-gift-read-ip",
    ]);
  });

  it("defines the gift share fields and the partial unique share-id index", () => {
    const gifts = CORE_COLLECTION_DEFINITIONS.find(
      (definition) => definition.name === COLLECTIONS.gifts,
    );
    const schema = (
      gifts?.validator as
        | {
            $jsonSchema: {
              properties: Record<string, Record<string, unknown>>;
              required: string[];
            };
          }
        | undefined
    )?.$jsonSchema;

    expect(schema?.properties["shareId"]).toEqual({
      bsonType: "string",
      pattern: "^[A-Za-z0-9_-]{22}$",
    });
    expect(schema?.properties["publishedAt"]).toEqual({ bsonType: "date" });
    expect(schema?.required).not.toContain("shareId");
    expect(schema?.required).not.toContain("publishedAt");
    expect(gifts?.indexes).toContainEqual({
      key: { shareId: 1 },
      options: {
        name: "gifts_share_id_unique",
        partialFilterExpression: { shareId: { $type: "string" } },
        unique: true,
      },
    });

    const sharePattern = new RegExp(String(schema?.properties["shareId"]?.["pattern"]));
    expect(sharePattern.test("a".repeat(22))).toBe(true);
    expect(sharePattern.test("a".repeat(21))).toBe(false);
  });

  it("defines the immutable publication record with unique share and revision indexes", () => {
    const publications = CORE_COLLECTION_DEFINITIONS.find(
      (definition) => definition.name === COLLECTIONS.giftPublications,
    );
    const schema = (
      publications?.validator as
        | {
            $jsonSchema: {
              additionalProperties: boolean;
              properties: Record<string, Record<string, unknown>>;
              required: string[];
            };
          }
        | undefined
    )?.$jsonSchema;

    expect(schema?.additionalProperties).toBe(true);
    expect(schema?.required).toEqual([
      "_id",
      "giftId",
      "shareId",
      "revision",
      "templateId",
      "templateVersion",
      "artifactContentHash",
      "content",
      "assetIds",
      "audioTrackId",
      "publishedAt",
      "createdAt",
    ]);
    expect(schema?.properties["artifactContentHash"]).toEqual({
      bsonType: "string",
      pattern: "^[a-f0-9]{64}$",
    });
    expect(schema?.properties["audioTrackId"]).toEqual({ bsonType: ["string", "null"] });
    expect(publications?.indexes).toEqual([
      {
        key: { giftId: 1, revision: 1 },
        options: { name: "gift_publications_gift_revision_unique", unique: true },
      },
    ]);
  });

  function rateLimitValidatorWithScopes(scopes: readonly string[]): unknown {
    const apiRateLimits = CORE_COLLECTION_DEFINITIONS.find(
      (definition) => definition.name === COLLECTIONS.apiRateLimits,
    );
    const validator = structuredClone(apiRateLimits?.validator) as {
      $jsonSchema: { properties: { scope: { enum: string[] } } };
    };
    validator.$jsonSchema.properties.scope.enum = [...scopes];
    return validator;
  }

  function giftsWithoutShareFields(fake: FakeDatabase): void {
    const gifts = CORE_COLLECTION_DEFINITIONS.find(
      (definition) => definition.name === COLLECTIONS.gifts,
    );
    const validator = structuredClone(gifts?.validator) as {
      $jsonSchema: { properties: Record<string, unknown> };
    };
    delete validator.$jsonSchema.properties["shareId"];
    delete validator.$jsonSchema.properties["publishedAt"];
    fake.validators.set(COLLECTIONS.gifts, validator);
    const indexes = fake.collection(COLLECTIONS.gifts).indexDefinitions;
    indexes.splice(
      indexes.findIndex((index) => index["name"] === "gifts_share_id_unique"),
      1,
    );
  }

  it("upgrades a version 6 database to version 9 in one run", async () => {
    const fake = new FakeDatabase();
    const database = fake as unknown as Db;
    await runDatabaseMigrations(database);
    // The version 6 schema: no preview tokens, no publications, the old scopes and gift fields.
    fake.collections.delete(COLLECTIONS.previewTokens);
    fake.collections.delete(COLLECTIONS.giftPublications);
    fake.collections.delete(COLLECTIONS.analyticsEvents);
    fake.validators.set(
      COLLECTIONS.apiRateLimits,
      rateLimitValidatorWithScopes(["gift-claim", "gift-create", "gift-update", "media-upload"]),
    );
    giftsWithoutShareFields(fake);
    fake.collection(COLLECTIONS.databaseMigrations).migrationVersion = 6;

    await expect(verifyDatabaseSchema(database)).rejects.toThrow(
      "MongoDB validator mismatch: apiRateLimits",
    );

    await runDatabaseMigrations(database);
    expect(fake.collections.has(COLLECTIONS.previewTokens)).toBe(true);
    expect(fake.collections.has(COLLECTIONS.giftPublications)).toBe(true);
    expect(
      fake.collection(COLLECTIONS.previewTokens).indexDefinitions.map((index) => index["name"]),
    ).toContain("preview_tokens_expiry_ttl");
    expect(
      fake.collection(COLLECTIONS.gifts).indexDefinitions.map((index) => index["name"]),
    ).toContain("gifts_share_id_unique");
    expect(fake.collections.has(COLLECTIONS.analyticsEvents)).toBe(true);
    expect(fake.collection(COLLECTIONS.databaseMigrations).migrationVersion).toBe(10);
    await expect(verifyDatabaseSchema(database)).resolves.toBeUndefined();
  });

  it("upgrades a version 7 database by adding publications and share fields", async () => {
    const fake = new FakeDatabase();
    const database = fake as unknown as Db;
    await runDatabaseMigrations(database);
    fake.collections.delete(COLLECTIONS.giftPublications);
    fake.collections.delete(COLLECTIONS.analyticsEvents);
    fake.validators.set(
      COLLECTIONS.apiRateLimits,
      rateLimitValidatorWithScopes([
        "gift-claim",
        "gift-create",
        "gift-preview",
        "gift-update",
        "media-upload",
      ]),
    );
    giftsWithoutShareFields(fake);
    fake.collection(COLLECTIONS.databaseMigrations).migrationVersion = 7;

    await expect(verifyDatabaseSchema(database)).rejects.toThrow("MongoDB validator mismatch");

    await runDatabaseMigrations(database);
    expect(
      fake.collection(COLLECTIONS.giftPublications).indexDefinitions.map((index) => index["name"]),
    ).toEqual(["_id_", "gift_publications_gift_revision_unique"]);
    expect(fake.collections.has(COLLECTIONS.analyticsEvents)).toBe(true);
    expect(fake.collection(COLLECTIONS.databaseMigrations).migrationVersion).toBe(10);
    await expect(verifyDatabaseSchema(database)).resolves.toBeUndefined();
  });

  it("upgrades a version 9 database: pointer and detach fields, legacy share index, backfill", async () => {
    const fake = new FakeDatabase();
    const database = fake as unknown as Db;
    await runDatabaseMigrations(database);
    fake.collection(COLLECTIONS.giftPublications).indexDefinitions.push({
      key: { shareId: 1 },
      name: "gift_publications_share_id_unique",
      unique: true,
    });
    fake
      .collection(COLLECTIONS.gifts)
      .documents.push(
        { _id: "published", revision: 7, status: "published" },
        { _id: "draft", revision: 2, status: "draft" },
      );
    fake.collection(COLLECTIONS.databaseMigrations).migrationVersion = 9;

    await expect(verifyDatabaseSchema(database)).rejects.toThrow(
      "Legacy MongoDB index remains: giftPublications.gift_publications_share_id_unique",
    );

    await runDatabaseMigrations(database);
    expect(
      fake.collection(COLLECTIONS.giftPublications).indexDefinitions.map((index) => index["name"]),
    ).not.toContain("gift_publications_share_id_unique");
    expect(fake.collection(COLLECTIONS.gifts).documents).toEqual([
      { _id: "published", publishedRevision: 7, revision: 7, status: "published" },
      { _id: "draft", revision: 2, status: "draft" },
    ]);
    expect(fake.collection(COLLECTIONS.databaseMigrations).migrationVersion).toBe(10);
    await expect(verifyDatabaseSchema(database)).resolves.toBeUndefined();
  });

  it("backfills only published gifts without a pointer, and changes nothing on a second run", async () => {
    const fake = new FakeDatabase();
    const database = fake as unknown as Db;
    fake
      .collection(COLLECTIONS.gifts)
      .documents.push({ _id: "edited", publishedRevision: 7, revision: 9, status: "published" });

    await runDatabaseMigrations(database);
    await runDatabaseMigrations(database);

    const gifts = fake.collection(COLLECTIONS.gifts);
    expect(gifts.updateMany).toHaveBeenCalledWith(
      { publishedRevision: { $exists: false }, status: "published" },
      [{ $set: { publishedRevision: "$revision" } }],
    );
    expect(gifts.documents).toEqual([
      { _id: "edited", publishedRevision: 7, revision: 9, status: "published" },
    ]);
  });

  it("validates the publication pointer and the detach time", () => {
    const schemaOf = (name: string) =>
      (
        CORE_COLLECTION_DEFINITIONS.find((definition) => definition.name === name)?.validator as
          { $jsonSchema: { properties: Record<string, unknown>; required: string[] } } | undefined
      )?.$jsonSchema;

    expect(schemaOf(COLLECTIONS.gifts)?.properties["publishedRevision"]).toEqual({
      bsonType: "int",
      minimum: 0,
    });
    expect(schemaOf(COLLECTIONS.gifts)?.required).not.toContain("publishedRevision");
    expect(schemaOf(COLLECTIONS.assets)?.properties["detachedAt"]).toEqual({
      bsonType: ["date", "null"],
    });
    expect(schemaOf(COLLECTIONS.assets)?.required).not.toContain("detachedAt");
  });

  it("defines the analytics event record with a TTL index and a per-step time index", () => {
    const analyticsEvents = CORE_COLLECTION_DEFINITIONS.find(
      (definition) => definition.name === COLLECTIONS.analyticsEvents,
    );
    const schema = (
      analyticsEvents?.validator as
        | {
            $jsonSchema: {
              properties: Record<string, { bsonType?: unknown; enum?: string[]; pattern?: string }>;
              required: string[];
            };
          }
        | undefined
    )?.$jsonSchema;

    expect(schema?.required).toEqual([
      "_id",
      "name",
      "giftRef",
      "templateId",
      "templateVersion",
      "sessionId",
      "sceneId",
      "occurredAt",
      "expiresAt",
    ]);
    expect(schema?.properties["name"]?.enum).toEqual([
      "customization_started",
      "required_content_completed",
      "preview_started",
      "publish_clicked",
      "gift_published",
      "gift_open_interaction",
      "scene_completed",
      "gift_completed",
    ]);
    expect(schema?.properties["sessionId"]?.bsonType).toEqual(["string", "null"]);
    expect(schema?.properties["sceneId"]?.bsonType).toEqual(["string", "null"]);
    const giftRefPattern = new RegExp(schema?.properties["giftRef"]?.pattern ?? "^$");
    expect(giftRefPattern.test("A".repeat(42) + "_")).toBe(true);
    // A raw SHA-256 hex digest is not a gift reference.
    expect(giftRefPattern.test("a".repeat(64))).toBe(false);
    expect(analyticsEvents?.indexes).toEqual([
      {
        key: { expiresAt: 1 },
        options: { expireAfterSeconds: 0, name: "analytics_events_expiry_ttl" },
      },
      { key: { name: 1, occurredAt: 1 }, options: { name: "analytics_events_name_occurred" } },
    ]);
  });

  it("upgrades a version 8 database by adding analytics events and the analytics scopes", async () => {
    const fake = new FakeDatabase();
    const database = fake as unknown as Db;
    await runDatabaseMigrations(database);
    fake.collections.delete(COLLECTIONS.analyticsEvents);
    fake.validators.set(
      COLLECTIONS.apiRateLimits,
      rateLimitValidatorWithScopes([
        "gift-claim",
        "gift-create",
        "gift-preview",
        "gift-publish",
        "gift-update",
        "media-upload",
        "public-gift-read",
        "public-gift-read-ip",
      ]),
    );
    fake.collection(COLLECTIONS.databaseMigrations).migrationVersion = 8;
    const publications = fake.collection(COLLECTIONS.giftPublications);
    const indexesBefore = JSON.stringify(publications.indexDefinitions);

    await expect(verifyDatabaseSchema(database)).rejects.toThrow(
      "MongoDB validator mismatch: apiRateLimits",
    );

    await runDatabaseMigrations(database);
    expect(
      fake.collection(COLLECTIONS.analyticsEvents).indexDefinitions.map((index) => index["name"]),
    ).toEqual(
      expect.arrayContaining(["analytics_events_expiry_ttl", "analytics_events_name_occurred"]),
    );
    expect(JSON.stringify(publications.indexDefinitions)).toBe(indexesBefore);
    expect(fake.collection(COLLECTIONS.databaseMigrations).migrationVersion).toBe(10);
    await expect(verifyDatabaseSchema(database)).resolves.toBeUndefined();
  });

  it("detects drift in the analytics validator and TTL index", async () => {
    const fake = new FakeDatabase();
    const database = fake as unknown as Db;
    await runDatabaseMigrations(database);

    fake.validators.set(COLLECTIONS.analyticsEvents, { wrong: true });
    await expect(verifyDatabaseSchema(database)).rejects.toThrow(
      "MongoDB validator mismatch: analyticsEvents",
    );

    await runDatabaseMigrations(database);
    const indexes = fake.collection(COLLECTIONS.analyticsEvents).indexDefinitions;
    const ttl = indexes.findIndex((index) => index["name"] === "analytics_events_expiry_ttl");
    const { expireAfterSeconds: _ttl, ...withoutTtl } = indexes[ttl] ?? {};
    indexes.splice(ttl, 1, withoutTtl);
    await expect(verifyDatabaseSchema(database)).rejects.toThrow(
      "MongoDB index mismatch: analyticsEvents.analytics_events_expiry_ttl",
    );

    await runDatabaseMigrations(database);
    expect(
      fake
        .collection(COLLECTIONS.analyticsEvents)
        .indexDefinitions.find((index) => index["name"] === "analytics_events_expiry_ttl"),
    ).toEqual(expect.objectContaining({ expireAfterSeconds: 0 }));
    await expect(verifyDatabaseSchema(database)).resolves.toBeUndefined();
  });

  it("detects drift in the publication validator and indexes", async () => {
    const fake = new FakeDatabase();
    const database = fake as unknown as Db;
    await runDatabaseMigrations(database);

    fake.validators.set(COLLECTIONS.giftPublications, { wrong: true });
    await expect(verifyDatabaseSchema(database)).rejects.toThrow(
      "MongoDB validator mismatch: giftPublications",
    );

    await runDatabaseMigrations(database);
    const indexes = fake.collection(COLLECTIONS.giftPublications).indexDefinitions;
    const revisionIndex = indexes.findIndex(
      (index) => index["name"] === "gift_publications_gift_revision_unique",
    );
    indexes.splice(revisionIndex, 1, { ...indexes[revisionIndex], unique: false });
    await expect(verifyDatabaseSchema(database)).rejects.toThrow(
      "MongoDB index mismatch: giftPublications.gift_publications_gift_revision_unique",
    );

    await runDatabaseMigrations(database);
    const giftIndexes = fake.collection(COLLECTIONS.gifts).indexDefinitions;
    const giftShareIndex = giftIndexes.findIndex(
      (index) => index["name"] === "gifts_share_id_unique",
    );
    giftIndexes.splice(giftShareIndex, 1, {
      ...giftIndexes[giftShareIndex],
      partialFilterExpression: undefined,
      sparse: true,
    });
    await expect(verifyDatabaseSchema(database)).rejects.toThrow(
      "MongoDB index mismatch: gifts.gifts_share_id_unique",
    );
  });

  it("defines the optimistic concurrency and template identity indexes", () => {
    const gifts = CORE_COLLECTION_DEFINITIONS.find(
      (definition) => definition.name === COLLECTIONS.gifts,
    );
    const templateVersions = CORE_COLLECTION_DEFINITIONS.find(
      (definition) => definition.name === COLLECTIONS.templateVersions,
    );

    expect(gifts?.indexes.map((index) => index.options.name)).toContain("gifts_public_id_unique");
    expect(templateVersions?.indexes.map((index) => index.options.name)).toContain(
      "template_versions_identity_unique",
    );
  });

  it("creates, updates and verifies the reproducible schema", async () => {
    const fake = new FakeDatabase();
    const database = fake as unknown as Db;

    await runDatabaseMigrations(database);
    await expect(verifyDatabaseSchema(database)).resolves.toBeUndefined();
    await runDatabaseMigrations(database);

    expect(fake.collections.has(COLLECTIONS.gifts)).toBe(true);
    expect(fake.collection(COLLECTIONS.databaseMigrations).updateOne).toHaveBeenCalledTimes(2);
    expect(fake.command).toHaveBeenCalledWith(
      expect.objectContaining({ collMod: COLLECTIONS.gifts }),
    );
  });

  it("removes the legacy asset storage-key index during the Sprint 2 migration", async () => {
    const fake = new FakeDatabase();
    const assets = fake.collection(COLLECTIONS.assets);
    assets.indexDefinitions.push({
      key: { storageKey: 1 },
      name: "assets_storage_key_unique",
      unique: true,
    });

    await runDatabaseMigrations(fake as unknown as Db);

    expect(assets.indexDefinitions.map((index) => index["name"])).not.toContain(
      "assets_storage_key_unique",
    );
    await expect(verifyDatabaseSchema(fake as unknown as Db)).resolves.toBeUndefined();
  });

  it("reports a missing collection during verification", async () => {
    const database = new FakeDatabase() as unknown as Db;

    await expect(verifyDatabaseSchema(database)).rejects.toThrow("Missing MongoDB collection");
  });

  it("reports validator, index option and schema-version drift", async () => {
    const fake = new FakeDatabase();
    const database = fake as unknown as Db;
    await runDatabaseMigrations(database);

    fake.validators.set(COLLECTIONS.gifts, { wrong: true });
    await expect(verifyDatabaseSchema(database)).rejects.toThrow("validator mismatch");

    const gifts = CORE_COLLECTION_DEFINITIONS.find(
      (definition) => definition.name === COLLECTIONS.gifts,
    );
    fake.validators.set(COLLECTIONS.gifts, gifts?.validator);
    const publicIdIndex = fake
      .collection(COLLECTIONS.gifts)
      .indexDefinitions.find((index) => index["name"] === "gifts_public_id_unique")!;
    fake
      .collection(COLLECTIONS.gifts)
      .indexDefinitions.splice(
        fake.collection(COLLECTIONS.gifts).indexDefinitions.indexOf(publicIdIndex),
        1,
        { ...publicIdIndex, unique: false },
      );
    await expect(verifyDatabaseSchema(database)).rejects.toThrow("index mismatch");

    await runDatabaseMigrations(database);
    fake.collection(COLLECTIONS.databaseMigrations).migrationVersion = 1;
    await expect(verifyDatabaseSchema(database)).rejects.toThrow(
      "MongoDB schema version mismatch: expected 10, received 1.",
    );

    await runDatabaseMigrations(database);
    fake.collection(COLLECTIONS.assets).indexDefinitions.push({
      key: { storageKey: 1 },
      name: "assets_storage_key_unique",
      unique: true,
    });
    await expect(verifyDatabaseSchema(database)).rejects.toThrow("Legacy MongoDB index remains");
  });
});
