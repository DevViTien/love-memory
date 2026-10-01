import type * as DatabaseModule from "@love-memory/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  getDatabase: vi.fn(),
}));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
}));

import {
  mongoGiftPublicationRepository,
  toPublicationDocument,
  toPublicationDomain,
} from "./mongo-gift-publication-repository";

const publishedAt = new Date("2026-10-01T08:00:00.000Z");
const publication = {
  artifactContentHash: "f".repeat(64),
  assetIds: ["550e8400-e29b-41d4-a716-446655440000"],
  audioTrackId: "acoustic-morning",
  content: { "receiver-name": "An" },
  createdAt: publishedAt,
  giftId: "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  publishedAt,
  revision: 7,
  shareId: "Ab0_-cdefghijklmnopqrs",
  templateId: "memory-box",
  templateVersion: "1.1.0",
};

describe("Mongo gift publication repository", () => {
  let collectionName: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) => {
        collectionName = name;
        return { findOne: databaseMocks.findOne };
      },
    });
  });

  it("maps the record id to _id and back", () => {
    const document = toPublicationDocument(publication);

    expect(document).not.toHaveProperty("id");
    expect(document._id).toBe(publication.id);
    expect(toPublicationDomain(document)).toEqual(publication);
  });

  it("finds a publication by share id with an exact-match filter", async () => {
    databaseMocks.findOne.mockResolvedValue(toPublicationDocument(publication));

    await expect(
      mongoGiftPublicationRepository.findByShareId(publication.shareId),
    ).resolves.toEqual(publication);
    expect(collectionName).toBe("giftPublications");
    expect(databaseMocks.findOne).toHaveBeenCalledWith({
      shareId: { $eq: publication.shareId },
    });
  });

  it("returns null when nothing matches", async () => {
    databaseMocks.findOne.mockResolvedValue(null);

    await expect(mongoGiftPublicationRepository.findByShareId("x".repeat(22))).resolves.toBeNull();
  });

  it("refuses a malformed stored record", () => {
    expect(() =>
      toPublicationDomain({ ...toPublicationDocument(publication), artifactContentHash: "bad" }),
    ).toThrow();
  });
});
