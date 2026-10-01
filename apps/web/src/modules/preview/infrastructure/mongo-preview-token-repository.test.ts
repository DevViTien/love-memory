import { COLLECTIONS } from "@love-memory/database";
import type * as DatabaseModule from "@love-memory/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  collection: vi.fn(),
  findOne: vi.fn(),
  getDatabase: vi.fn(),
  insertOne: vi.fn(),
}));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
}));

import { mongoPreviewTokenRepository } from "./mongo-preview-token-repository";

const tokenHash = "a".repeat(64);
const createdAt = new Date("2026-10-01T10:00:00.000Z");
const expiresAt = new Date("2026-10-01T10:30:00.000Z");

describe("Mongo preview token repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.collection.mockReturnValue({
      findOne: databaseMocks.findOne,
      insertOne: databaseMocks.insertOne,
    });
    databaseMocks.getDatabase.mockResolvedValue({ collection: databaseMocks.collection });
    databaseMocks.insertOne.mockResolvedValue({ insertedId: tokenHash });
  });

  it("stores only the hash as _id, the gift id and the timestamps", async () => {
    await mongoPreviewTokenRepository.insert({
      createdAt,
      expiresAt,
      giftId: "gift-1",
      tokenHash,
    });

    expect(databaseMocks.collection).toHaveBeenCalledWith(COLLECTIONS.previewTokens);
    expect(databaseMocks.insertOne).toHaveBeenCalledExactlyOnceWith({
      _id: tokenHash,
      createdAt,
      expiresAt,
      giftId: "gift-1",
    });
  });

  it("looks up an active token by hash and expiry", async () => {
    const now = new Date("2026-10-01T10:10:00.000Z");
    databaseMocks.findOne.mockResolvedValueOnce({
      _id: tokenHash,
      createdAt,
      expiresAt,
      giftId: "gift-1",
    });

    await expect(mongoPreviewTokenRepository.findActive(tokenHash, now)).resolves.toEqual({
      expiresAt,
      giftId: "gift-1",
    });
    expect(databaseMocks.findOne).toHaveBeenCalledWith({
      _id: tokenHash,
      expiresAt: { $gt: now },
    });
  });

  it("returns null when no active token matches", async () => {
    databaseMocks.findOne.mockResolvedValueOnce(null);

    await expect(mongoPreviewTokenRepository.findActive(tokenHash, expiresAt)).resolves.toBeNull();
  });
});
