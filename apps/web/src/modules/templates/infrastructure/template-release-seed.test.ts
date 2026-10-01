import { describe, expect, it } from "vitest";

import { seedTemplateReleases } from "./seed-template-catalog";
import {
  canonicalJson,
  manifestContentHash,
  type SeedCollection,
  seedTemplateRelease,
  upsertTemplateVersion,
} from "./template-release-seed";

type StoredDocument = Record<string, unknown> & { _id: string; manifest?: unknown };

/** An in-memory collection that applies `$set`/`$setOnInsert` upserts like MongoDB. */
function fakeCollection(initial: StoredDocument[] = []) {
  const documents = new Map(initial.map((document) => [document._id, structuredClone(document)]));
  const writes: string[] = [];
  const collection: SeedCollection = {
    findOne: ({ _id }) => Promise.resolve(documents.get(_id) ?? null),
    updateOne: ({ _id }, update) => {
      writes.push(_id);
      const existing = documents.get(_id);
      const set = update["$set"] as Record<string, unknown>;
      const setOnInsert = update["$setOnInsert"] as Record<string, unknown>;
      documents.set(_id, existing ? { ...existing, ...set } : { _id, ...setOnInsert, ...set });
      return Promise.resolve();
    },
  };
  return { collection, documents, writes };
}

const memoryBox = seedTemplateReleases[0]!;
const [legacy, current] = memoryBox.versions as [
  (typeof memoryBox.versions)[number],
  (typeof memoryBox.versions)[number],
];
const createdAt = new Date("2026-01-01T00:00:00.000Z");
const now = new Date("2026-10-01T00:00:00.000Z");

function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, reversedKeys(entry)]),
    );
  }
  return value;
}

describe("canonicalJson", () => {
  it("sorts object keys recursively, drops whitespace and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[3,1]},"b":1}',
    );
    expect(canonicalJson({ a: { c: "x", d: [3, 1] }, b: 1 })).toBe(
      canonicalJson({ b: 1, a: { d: [3, 1], c: "x" } }),
    );
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(canonicalJson(undefined)).toBe("null");
  });
});

describe("upsertTemplateVersion", () => {
  it("inserts the raw manifest, its fixture and the canonical hash", async () => {
    const { collection, documents } = fakeCollection();

    await upsertTemplateVersion(collection, "memory-box", current, now);

    expect(documents.get("memory-box@1.1.0")).toEqual({
      _id: "memory-box@1.1.0",
      contentHash: manifestContentHash(current.manifest),
      createdAt: now,
      manifest: current.manifest,
      previewFixture: current.previewFixture,
      status: "published",
      templateId: "memory-box",
      updatedAt: now,
      version: "1.1.0",
    });
  });

  it("accepts a stored manifest with a different key order and rewrites nothing", async () => {
    const stored = {
      _id: "memory-box@1.0.0",
      contentHash: "legacy-hash",
      createdAt,
      manifest: reversedKeys(legacy.manifest),
      previewFixture: { stored: true },
      status: "published",
      templateId: "memory-box",
      updatedAt: createdAt,
      version: "1.0.0",
    };
    const { collection, documents } = fakeCollection([stored]);

    await upsertTemplateVersion(collection, "memory-box", legacy, now);
    await upsertTemplateVersion(collection, "memory-box", legacy, now);

    expect(documents.get("memory-box@1.0.0")).toEqual({
      ...stored,
      status: "retired",
      updatedAt: now,
    });
  });

  it("refuses a conflicting stored release before writing anything for the template", async () => {
    const conflicting = {
      _id: "memory-box@1.1.0",
      contentHash: "old",
      createdAt,
      manifest: { ...current.manifest, meta: { name: "Khác" } },
      previewFixture: {},
      status: "published",
      templateId: "memory-box",
      updatedAt: createdAt,
      version: "1.1.0",
    };
    const versions = fakeCollection([conflicting]);
    const templates = fakeCollection();

    await expect(
      seedTemplateRelease(
        { templateVersions: versions.collection, templates: templates.collection },
        memoryBox,
        0,
        now,
      ),
    ).rejects.toThrow("Template release memory-box@1.1.0 is immutable and differs from the seed");
    expect(versions.writes).toEqual([]);
    expect(templates.writes).toEqual([]);
    expect(versions.documents.get("memory-box@1.1.0")).toEqual(conflicting);
  });

  it("refuses a version whose preview fixture fails validation", async () => {
    const { collection, writes } = fakeCollection();

    await expect(
      upsertTemplateVersion(
        collection,
        "memory-box",
        { ...current, previewFixture: { memories: [] } },
        now,
      ),
    ).rejects.toThrow();
    expect(writes).toEqual([]);
  });
});

describe("seedTemplateRelease", () => {
  it("retires 1.0.0 with its stored hash and switches the current version to 1.1.0", async () => {
    const storedLegacy = {
      _id: "memory-box@1.0.0",
      contentHash: "3bcda99c59f72576cee4528aa166baa08b900953e82d749e5b8d67a21f29825f",
      createdAt,
      manifest: legacy.manifest,
      previewFixture: legacy.previewFixture,
      status: "published",
      templateId: "memory-box",
      updatedAt: createdAt,
      version: "1.0.0",
    };
    const versions = fakeCollection([storedLegacy]);
    const templates = fakeCollection([
      {
        _id: "memory-box",
        createdAt,
        currentVersion: "1.0.0",
        sortOrder: 0,
        status: "published",
        updatedAt: createdAt,
      },
    ]);
    const collections = { templateVersions: versions.collection, templates: templates.collection };

    await seedTemplateRelease(collections, memoryBox, 0, now);
    await seedTemplateRelease(collections, memoryBox, 0, now);

    expect(versions.documents.get("memory-box@1.0.0")).toMatchObject({
      contentHash: storedLegacy.contentHash,
      status: "retired",
    });
    expect(versions.documents.get("memory-box@1.1.0")).toMatchObject({ status: "published" });
    expect([...versions.documents.keys()]).toEqual(["memory-box@1.0.0", "memory-box@1.1.0"]);
    expect(templates.documents.get("memory-box")).toEqual({
      _id: "memory-box",
      createdAt,
      currentVersion: "1.1.0",
      sortOrder: 0,
      status: "published",
      updatedAt: now,
    });
  });

  it("fails when the current version is not among the release versions", async () => {
    const versions = fakeCollection();
    const templates = fakeCollection();

    await expect(
      seedTemplateRelease(
        { templateVersions: versions.collection, templates: templates.collection },
        { ...memoryBox, currentVersion: "9.9.9" },
        0,
        now,
      ),
    ).rejects.toThrow("Missing current version of template memory-box");
    expect(templates.writes).toEqual([]);
  });
});
