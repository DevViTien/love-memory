import type * as DatabaseModule from "@love-memory/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
}));

import { mongoJobOutbox } from "./mongo-job-outbox";

const now = new Date("2026-10-08T10:00:00.000Z");
const types = ["gift.assets.cleanup.v1"] as const;

describe("Mongo job outbox", () => {
  const collection = {
    find: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) => {
        expect(name).toBe("jobOutbox");
        return collection;
      },
    });
  });

  it("claims the oldest due or stale job of the generic types only", async () => {
    collection.findOneAndUpdate.mockResolvedValue({
      _id: "job-1",
      attempts: 2,
      payload: { giftId: "g" },
      type: "gift.assets.cleanup.v1",
    });

    await expect(mongoJobOutbox.claimNext(types, now)).resolves.toEqual({
      attempts: 2,
      id: "job-1",
      payload: { giftId: "g" },
      type: "gift.assets.cleanup.v1",
    });
    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      {
        $or: [
          { availableAt: { $lte: now }, status: "pending" },
          { status: "processing", updatedAt: { $lte: new Date("2026-10-08T09:50:00.000Z") } },
        ],
        type: { $in: ["gift.assets.cleanup.v1"] },
      },
      { $inc: { attempts: 1 }, $set: { status: "processing", updatedAt: now } },
      { returnDocument: "after", sort: { availableAt: 1, createdAt: 1 } },
    );
  });

  it("claims nothing without registered types or without a job", async () => {
    await expect(mongoJobOutbox.claimNext([], now)).resolves.toBeNull();
    expect(collection.findOneAndUpdate).not.toHaveBeenCalled();
    collection.findOneAndUpdate.mockResolvedValue(null);
    await expect(mongoJobOutbox.claimNext(types, now)).resolves.toBeNull();
  });

  it("finishes, retries and buries only the job's own processing lease", async () => {
    const later = new Date("2026-10-08T10:01:00.000Z");
    await mongoJobOutbox.complete("job-1", now);
    await mongoJobOutbox.retryLater("job-1", "JOB_FAILED", later, now);
    await mongoJobOutbox.markDead("job-1", "INVALID_PAYLOAD", now);

    expect(collection.updateOne.mock.calls).toEqual([
      [
        { _id: "job-1", status: "processing" },
        { $set: { lastErrorCode: null, status: "completed", updatedAt: now } },
      ],
      [
        { _id: "job-1", status: "processing" },
        {
          $set: {
            availableAt: later,
            lastErrorCode: "JOB_FAILED",
            status: "pending",
            updatedAt: now,
          },
        },
      ],
      [
        { _id: "job-1", status: "processing" },
        { $set: { lastErrorCode: "INVALID_PAYLOAD", status: "dead", updatedAt: now } },
      ],
    ]);
  });

  it("finds an overdue generic job without reading its content", async () => {
    collection.findOne.mockResolvedValue({ _id: "job-1" });
    const cutoff = new Date("2026-10-08T09:50:00.000Z");

    await expect(mongoJobOutbox.hasOverdueJob(types, cutoff)).resolves.toBe(true);
    expect(collection.findOne).toHaveBeenCalledWith(
      {
        availableAt: { $lte: cutoff },
        status: "pending",
        type: { $in: ["gift.assets.cleanup.v1"] },
      },
      { projection: { _id: 1 } },
    );
    await expect(mongoJobOutbox.hasOverdueJob([], cutoff)).resolves.toBe(false);
  });

  it("lists dead jobs newest first without their payload", async () => {
    const toArray = vi.fn(() =>
      Promise.resolve([
        {
          _id: "job-1",
          attempts: 5,
          lastErrorCode: "JOB_FAILED",
          type: "gift.assets.cleanup.v1",
          updatedAt: now,
        },
      ]),
    );
    const limit = vi.fn(() => ({ toArray }));
    const sort = vi.fn(() => ({ limit }));
    collection.find.mockReturnValue({ sort });

    await expect(mongoJobOutbox.listDead(100)).resolves.toEqual([
      {
        attempts: 5,
        id: "job-1",
        lastErrorCode: "JOB_FAILED",
        type: "gift.assets.cleanup.v1",
        updatedAt: now,
      },
    ]);
    expect(collection.find).toHaveBeenCalledWith(
      { status: "dead" },
      { projection: { attempts: 1, lastErrorCode: 1, type: 1, updatedAt: 1 } },
    );
    expect(sort).toHaveBeenCalledWith({ updatedAt: -1 });
    expect(limit).toHaveBeenCalledWith(100);
  });

  it("revives only a dead job, and tells a live job from an unknown one", async () => {
    collection.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });
    await expect(mongoJobOutbox.revive("job-1", now)).resolves.toBe("revived");
    expect(collection.updateOne).toHaveBeenCalledWith(
      { _id: "job-1", status: "dead" },
      { $set: { attempts: 0, availableAt: now, status: "pending", updatedAt: now } },
    );

    collection.updateOne.mockResolvedValue({ modifiedCount: 0 });
    collection.findOne.mockResolvedValueOnce({ _id: "job-2" });
    await expect(mongoJobOutbox.revive("job-2", now)).resolves.toBe("not-dead");
    collection.findOne.mockResolvedValueOnce(null);
    await expect(mongoJobOutbox.revive("job-3", now)).resolves.toBe("not-found");
  });
});
