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
  readonly indexNames = ["_id_"];
  readonly updateOne = vi.fn(() => Promise.resolve());

  createIndex(_key: unknown, options: Readonly<{ name: string }>) {
    this.indexNames.push(options.name);
    return Promise.resolve(options.name);
  }

  indexes() {
    return Promise.resolve(this.indexNames.map((name) => ({ name })));
  }
}

class FakeDatabase {
  readonly collections = new Map<string, FakeCollection>();
  readonly command = vi.fn(() => Promise.resolve({ ok: 1 }));

  collection(name: string) {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new FakeCollection();
      this.collections.set(name, collection);
    }
    return collection;
  }

  createCollection(name: string) {
    const collection = this.collection(name);
    return Promise.resolve(collection);
  }

  listCollections(filter: Readonly<{ name: string }>) {
    return { hasNext: () => Promise.resolve(this.collections.has(filter.name)) };
  }
}

describe("database schema migration", () => {
  it("covers every Sprint 1 collection with stable named indexes", () => {
    const definitions = new Map(
      CORE_COLLECTION_DEFINITIONS.map((definition) => [definition.name, definition]),
    );

    expect(DATABASE_SCHEMA_VERSION).toBe(1);
    expect(definitions.has(COLLECTIONS.users)).toBe(true);
    expect(definitions.has(COLLECTIONS.templates)).toBe(true);
    expect(definitions.has(COLLECTIONS.templateVersions)).toBe(true);
    expect(definitions.has(COLLECTIONS.gifts)).toBe(true);
    expect(definitions.has(COLLECTIONS.giftRevisions)).toBe(true);
    expect(definitions.has(COLLECTIONS.assets)).toBe(true);
    expect(definitions.has(COLLECTIONS.idempotencyKeys)).toBe(true);
    expect(definitions.has(COLLECTIONS.jobOutbox)).toBe(true);

    const names = CORE_COLLECTION_DEFINITIONS.flatMap((definition) =>
      definition.indexes.map((index) => index.options.name),
    );
    expect(names.every(Boolean)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
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

  it("reports a missing collection during verification", async () => {
    const database = new FakeDatabase() as unknown as Db;

    await expect(verifyDatabaseSchema(database)).rejects.toThrow("Missing MongoDB collection");
  });
});
