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
    databaseMocks.getDatabase.mockResolvedValue({
      collection: () => ({
        find: () => ({
          sort: () => ({ toArray: () => Promise.resolve(documents) }),
        }),
        findOne: (filter: Readonly<{ templateId: string }>) =>
          Promise.resolve(documents.find((document) => document.templateId === filter.templateId)),
      }),
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
});
