import type * as DatabaseModule from "@love-memory/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn(), getMongoClient: vi.fn() }));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
  getMongoClient: databaseMocks.getMongoClient,
}));

import { mongoGiftDeletionRepository } from "./mongo-gift-deletion-repository";

const giftId = "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89";
const deletedAt = new Date("2026-10-10T12:00:00.000Z");
const tombstone = {
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  deletedAt,
  deletionRequestedAt: new Date("2026-10-10T11:00:00.000Z"),
  expiresAt: new Date("2027-10-10T12:00:00.000Z"),
  id: giftId,
  ownerId: "user-1",
  publicId: "pub-1",
  publishedAt: null,
};

describe("Mongo gift deletion repository", () => {
  const collections: Record<
    string,
    {
      deleteMany: ReturnType<typeof vi.fn>;
      deleteOne?: ReturnType<typeof vi.fn>;
      findOne?: ReturnType<typeof vi.fn>;
      insertOne?: ReturnType<typeof vi.fn>;
      replaceOne?: ReturnType<typeof vi.fn>;
    }
  > = {};
  const session = {
    withTransaction: vi.fn(async (work: () => Promise<void>) => {
      await work();
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const name of [
      "giftRevisions",
      "giftPublications",
      "previewTokens",
      "idempotencyKeys",
      "jobOutbox",
      "giftTombstones",
      "gifts",
      "auditLog",
    ]) {
      collections[name] = {
        deleteMany: vi.fn(),
        deleteOne: vi.fn(() => Promise.resolve({ deletedCount: 1 })),
        findOne: vi.fn(),
        insertOne: vi.fn(),
        replaceOne: vi.fn(),
      };
    }
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) => collections[name],
    });
    databaseMocks.getMongoClient.mockResolvedValue({
      withSession: (work: (value: typeof session) => Promise<void>) => work(session),
    });
  });

  it("reads only a deleting gift", async () => {
    collections["gifts"]!.findOne!.mockResolvedValueOnce(null);

    await expect(mongoGiftDeletionRepository.findDeleting(giftId)).resolves.toBeNull();
    expect(collections["gifts"]!.findOne).toHaveBeenCalledWith({ _id: giftId, status: "deleting" });
  });

  it("deletes derived records and other jobs that no worker holds", async () => {
    await mongoGiftDeletionRepository.deleteDerived(giftId, "job-1");

    for (const name of ["giftRevisions", "giftPublications", "previewTokens", "idempotencyKeys"]) {
      expect(collections[name]!.deleteMany).toHaveBeenCalledWith({ giftId });
    }
    expect(collections["jobOutbox"]!.deleteMany).toHaveBeenCalledWith({
      _id: { $ne: "job-1" },
      "payload.giftId": giftId,
      status: { $ne: "processing" },
    });
  });

  it("writes the tombstone, removes the gift and records gift.deleted in one transaction", async () => {
    await mongoGiftDeletionRepository.purge({ photos: 2, published: false, tombstone });

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    const { id: _id, ...fields } = tombstone;
    expect(collections["giftTombstones"]!.replaceOne).toHaveBeenCalledWith(
      { _id: giftId },
      fields,
      {
        session,
        upsert: true,
      },
    );
    expect(collections["gifts"]!.deleteOne).toHaveBeenCalledWith(
      { _id: giftId, status: "deleting" },
      { session },
    );
    expect(collections["auditLog"]!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "gift.deleted",
        actor: { id: "gift.delete.v1", kind: "system" },
        metadata: { photos: 2, published: false },
        requestId: null,
        target: { id: giftId, kind: "gift" },
      }),
      { session },
    );
  });

  it("records nothing again when the gift was already removed", async () => {
    collections["gifts"]!.deleteOne!.mockResolvedValueOnce({ deletedCount: 0 });

    await mongoGiftDeletionRepository.purge({ photos: 2, published: false, tombstone });

    expect(collections["auditLog"]!.insertOne).not.toHaveBeenCalled();
  });
});
