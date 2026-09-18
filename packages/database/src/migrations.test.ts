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

    expect(DATABASE_SCHEMA_VERSION).toBe(6);
    expect(definitions.has(COLLECTIONS.users)).toBe(true);
    expect(definitions.has(COLLECTIONS.apiRateLimits)).toBe(true);
    expect(definitions.has(COLLECTIONS.templates)).toBe(true);
    expect(definitions.has(COLLECTIONS.templateVersions)).toBe(true);
    expect(definitions.has(COLLECTIONS.gifts)).toBe(true);
    expect(definitions.has(COLLECTIONS.giftRevisions)).toBe(true);
    expect(definitions.has(COLLECTIONS.assets)).toBe(true);
    expect(definitions.has(COLLECTIONS.idempotencyKeys)).toBe(true);
    expect(definitions.has(COLLECTIONS.jobOutbox)).toBe(true);

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
    await expect(verifyDatabaseSchema(database)).rejects.toThrow("schema version mismatch");

    await runDatabaseMigrations(database);
    fake.collection(COLLECTIONS.assets).indexDefinitions.push({
      key: { storageKey: 1 },
      name: "assets_storage_key_unique",
      unique: true,
    });
    await expect(verifyDatabaseSchema(database)).rejects.toThrow("Legacy MongoDB index remains");
  });
});
