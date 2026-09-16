import type * as DatabaseModule from "@love-memory/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { seedTemplateManifests } from "./seed-template-catalog";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
}));

import { mongoTemplateCatalog } from "./mongo-template-catalog";

describe("Mongo template catalog", () => {
  const documents = seedTemplateManifests.map((manifest) => ({
    manifest,
    status: "published" as const,
    templateId: manifest.id,
    version: manifest.version,
  }));

  beforeEach(() => {
    databaseMocks.getDatabase.mockReset();
    const templates = documents.map((document, sortOrder) => ({
      _id: document.templateId,
      currentVersion: document.version,
      sortOrder,
      status: "published" as const,
    }));
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) =>
        name === "templates"
          ? {
              find: () => ({
                sort: () => ({ toArray: () => Promise.resolve(templates) }),
              }),
              findOne: (filter: Readonly<{ _id: string }>) =>
                Promise.resolve(templates.find((template) => template._id === filter._id) ?? null),
            }
          : {
              find: () => ({ toArray: () => Promise.resolve(documents) }),
              findOne: (filter: Readonly<{ templateId: string; version: string }>) =>
                Promise.resolve(
                  documents.find(
                    (document) =>
                      document.templateId === filter.templateId &&
                      document.version === filter.version,
                  ) ?? null,
                ),
            },
    });
  });

  it("maps published manifest documents to stable public summaries", async () => {
    await expect(mongoTemplateCatalog.listPublished()).resolves.toHaveLength(3);
    await expect(mongoTemplateCatalog.findPublishedById("memory-box")).resolves.toMatchObject({
      id: "memory-box",
      imageRequirement: { maxItems: 8, minItems: 3 },
    });
  });

  it("returns undefined for an unavailable template", async () => {
    await expect(mongoTemplateCatalog.findPublishedById("missing")).resolves.toBeUndefined();
  });

  it("selects only the current published version of each template", async () => {
    const oldVersion = { ...documents[0]!, version: "0.9.0" };
    const currentVersion = {
      ...documents[0]!,
      manifest: { ...documents[0]!.manifest, version: "2.0.0" },
      version: "2.0.0",
    };
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) =>
        name === "templates"
          ? {
              find: () => ({
                sort: () => ({
                  toArray: () =>
                    Promise.resolve([
                      {
                        _id: "memory-box",
                        currentVersion: "2.0.0",
                        sortOrder: 0,
                        status: "published",
                      },
                    ]),
                }),
              }),
              findOne: () =>
                Promise.resolve({
                  _id: "memory-box",
                  currentVersion: "2.0.0",
                  sortOrder: 0,
                  status: "published",
                }),
            }
          : {
              find: () => ({ toArray: () => Promise.resolve([oldVersion, currentVersion]) }),
              findOne: (filter: Readonly<{ version: string }>) =>
                Promise.resolve(filter.version === "2.0.0" ? currentVersion : null),
            },
    });

    await expect(mongoTemplateCatalog.listPublished()).resolves.toEqual([
      expect.objectContaining({ id: "memory-box", version: "2.0.0" }),
    ]);
    await expect(mongoTemplateCatalog.findPublishedById("memory-box")).resolves.toMatchObject({
      version: "2.0.0",
    });
  });
});
