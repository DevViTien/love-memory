import type * as DatabaseModule from "@love-memory/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { seedTemplateManifests } from "../../templates/infrastructure/seed-template-catalog";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
}));

import { mongoGiftTemplateRepository } from "./mongo-gift-template-repository";

describe("Mongo gift template repository", () => {
  beforeEach(() => {
    databaseMocks.getDatabase.mockReset();
    databaseMocks.getDatabase.mockResolvedValue({
      collection: () => ({
        findOne: (filter: Readonly<{ templateId: string; version: string }>) => {
          const manifest = seedTemplateManifests.find(
            (candidate) =>
              candidate.id === filter.templateId && candidate.version === filter.version,
          );
          return Promise.resolve(
            manifest
              ? {
                  manifest,
                  status: "published",
                  templateId: manifest.id,
                  version: manifest.version,
                }
              : null,
          );
        },
      }),
    });
  });

  it("returns only an exact published template version for new drafts", async () => {
    await expect(
      mongoGiftTemplateRepository.findCreatableManifest("memory-box", "1.0.0"),
    ).resolves.toMatchObject({ id: "memory-box", version: "1.0.0" });
    await expect(
      mongoGiftTemplateRepository.findCreatableManifest("memory-box", "2.0.0"),
    ).resolves.toBeNull();
  });

  it("allows immutable retired versions when editing an existing draft", async () => {
    await expect(
      mongoGiftTemplateRepository.findEditableManifest("memory-box", "1.0.0"),
    ).resolves.toMatchObject({ id: "memory-box", version: "1.0.0" });
  });
});
