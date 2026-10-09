import type * as DatabaseModule from "@love-memory/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn(), getMongoClient: vi.fn() }));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
  getMongoClient: databaseMocks.getMongoClient,
}));

import { mongoGiftLifecycleRepository } from "./mongo-gift-lifecycle-repository";

const now = new Date("2026-10-10T10:00:00.000Z");
const giftId = "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89";

describe("Mongo gift lifecycle repository", () => {
  const gifts = { updateOne: vi.fn() };
  const jobOutbox = { updateOne: vi.fn() };
  const session = {
    withTransaction: vi.fn(async (work: () => Promise<void>) => {
      await work();
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) => ({ gifts, jobOutbox })[name],
    });
    databaseMocks.getMongoClient.mockResolvedValue({
      withSession: (work: (value: typeof session) => Promise<void>) => work(session),
    });
  });

  it("pauses only a published gift", async () => {
    gifts.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });

    await expect(mongoGiftLifecycleRepository.pause(giftId, now)).resolves.toBe(true);
    expect(gifts.updateOne).toHaveBeenCalledWith(
      { _id: giftId, status: "published" },
      { $set: { pausedAt: now, status: "paused", updatedAt: now } },
    );
  });

  it("resumes only a paused gift that has not expired", async () => {
    gifts.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });

    await expect(mongoGiftLifecycleRepository.resume(giftId, now)).resolves.toBe(false);
    expect(gifts.updateOne).toHaveBeenCalledWith(
      { _id: giftId, expiresAt: { $gt: now }, status: "paused" },
      { $set: { status: "published", updatedAt: now }, $unset: { pausedAt: "" } },
    );
  });

  it("moves the gift to deleting and enqueues its purge in one transaction", async () => {
    gifts.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });

    await expect(mongoGiftLifecycleRepository.requestDeletion(giftId, now)).resolves.toBe(true);

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(gifts.updateOne).toHaveBeenCalledWith(
      { _id: giftId, status: { $in: ["draft", "published", "paused"] } },
      {
        $set: { deletionRequestedAt: now, status: "deleting", updatedAt: now },
        $unset: { pausedAt: "" },
      },
      { session },
    );
    expect(jobOutbox.updateOne).toHaveBeenCalledWith(
      { deduplicationKey: `gift.delete.v1:${giftId}` },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          payload: { giftId },
          type: "gift.delete.v1",
        }) as unknown,
      }),
      expect.objectContaining({ session, upsert: true }),
    );
  });

  it("enqueues nothing when the gift is no longer deletable", async () => {
    gifts.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });

    await expect(mongoGiftLifecycleRepository.requestDeletion(giftId, now)).resolves.toBe(false);
    expect(jobOutbox.updateOne).not.toHaveBeenCalled();
  });
});
