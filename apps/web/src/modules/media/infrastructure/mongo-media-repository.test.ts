import type * as DatabaseModule from "@love-memory/database";
import { type MediaAsset } from "@love-memory/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  getMongoClient: vi.fn(),
}));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
  getMongoClient: databaseMocks.getMongoClient,
}));

import { mongoMediaAssetRepository, mongoMediaWorkerRepository } from "./mongo-media-repository";

const now = new Date("2026-09-17T00:00:00.000Z");
const baseAsset: MediaAsset = {
  anonymousDraftId: null,
  attempts: 0,
  checksumSha256: null,
  createdAt: now,
  declaredContentType: "image/jpeg",
  declaredSizeBytes: 3,
  derivatives: [],
  expiresAt: new Date(now.getTime() + 60_000),
  failureCode: null,
  fieldId: "photos",
  fieldSlot: 0,
  giftId: "3d594650-3436-4ca1-8a1a-5fc8a10bd154",
  giftSlot: 0,
  id: "550e8400-e29b-41d4-a716-446655440000",
  ownerId: "user-1",
  placeholderDataUrl: null,
  sourceKey: "private/assets/source",
  status: "initiated",
  updatedAt: now,
};

function document(status: MediaAsset["status"] = "initiated") {
  const { id, ...values } = baseAsset;
  return {
    ...values,
    _id: id,
    expiresAt: status === "initiated" ? values.expiresAt : null,
    status,
  };
}

describe("Mongo media repositories", () => {
  const assets = {
    countDocuments: vi.fn(() => Promise.resolve(1)),
    find: vi.fn(() => ({
      sort: () => ({ toArray: () => Promise.resolve([document()]) }),
      toArray: () => Promise.resolve([] as unknown[]),
    })),
    findOne: vi.fn(() => Promise.resolve(document())),
    findOneAndUpdate: vi.fn(),
    insertOne: vi.fn(() => Promise.resolve({ acknowledged: true })),
    updateOne: vi.fn(() => Promise.resolve({ matchedCount: 1, modifiedCount: 1 })),
  };
  const jobs = {
    findOneAndUpdate: vi.fn(),
    insertOne: vi.fn(() => Promise.resolve({ acknowledged: true })),
    updateOne: vi.fn(() => Promise.resolve({ matchedCount: 0, modifiedCount: 0 })),
  };
  const database = {
    collection: vi.fn((name: string) => (name === "assets" ? assets : jobs)),
  };
  const session = {
    withTransaction: vi.fn(async (callback: () => Promise<void>) => callback()),
  };
  const client = {
    withSession: vi.fn(async (callback: (value: typeof session) => Promise<void>) =>
      callback(session),
    ),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.getDatabase.mockResolvedValue(database);
    databaseMocks.getMongoClient.mockResolvedValue(client);
    assets.countDocuments.mockResolvedValue(1);
    assets.findOne.mockResolvedValue(document());
    assets.findOneAndUpdate.mockResolvedValue(null);
    assets.find.mockReturnValue({
      sort: () => ({ toArray: () => Promise.resolve([document()]) }),
      toArray: () => Promise.resolve([]),
    });
    assets.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    jobs.findOneAndUpdate.mockResolvedValue(null);
    jobs.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
  });

  it("persists, reads, lists and counts gift-bound assets", async () => {
    await expect(mongoMediaAssetRepository.createWithinQuota(baseAsset, 30, 12)).resolves.toBe(
      true,
    );
    await expect(mongoMediaAssetRepository.findById(baseAsset.id)).resolves.toMatchObject({
      id: baseAsset.id,
    });
    await expect(mongoMediaAssetRepository.listByGiftId(baseAsset.giftId)).resolves.toHaveLength(1);
    await expect(mongoMediaAssetRepository.releaseInitiated(baseAsset.id, now)).resolves.toBe(true);
    await expect(mongoMediaAssetRepository.markDeleted(baseAsset.id, now)).resolves.toBe(true);
    await expect(
      mongoMediaAssetRepository.markFailed(baseAsset.id, "UPLOAD_INVALID", now),
    ).resolves.toBe(true);
    expect(assets.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ fieldSlot: 0, giftSlot: 0 }),
      expect.objectContaining({ session }),
    );
    expect(assets.updateOne).toHaveBeenCalledWith(
      { _id: baseAsset.id, status: "initiated" },
      { $set: { failureCode: "UPLOAD_INVALID", status: "failed", updatedAt: now } },
    );
  });

  it("includes pre-slot assets when enforcing the atomic quota", async () => {
    const preSlotAssets = Array.from({ length: 30 }, () => ({
      fieldId: "other-field",
      fieldSlot: null,
      giftSlot: null,
    }));
    assets.find.mockReturnValueOnce({
      sort: () => ({ toArray: () => Promise.resolve([]) }),
      toArray: () => Promise.resolve(preSlotAssets),
    });

    await expect(mongoMediaAssetRepository.createWithinQuota(baseAsset, 30, 12)).resolves.toBe(
      false,
    );
    expect(assets.insertOne).not.toHaveBeenCalled();
  });

  it("reserves the lowest free slots with Stable API reads only", async () => {
    assets.find.mockReturnValueOnce({
      sort: () => ({ toArray: () => Promise.resolve([]) }),
      toArray: () =>
        Promise.resolve([
          { fieldId: baseAsset.fieldId, fieldSlot: 0, giftSlot: 0 },
          { fieldId: "other-field", fieldSlot: 0, giftSlot: 1 },
        ]),
    });

    await expect(mongoMediaAssetRepository.createWithinQuota(baseAsset, 30, 12)).resolves.toBe(
      true,
    );
    expect(assets.find).toHaveBeenCalledWith(
      { giftId: baseAsset.giftId, status: { $in: expect.any(Array) as unknown } },
      expect.objectContaining({ session }),
    );
    expect(assets.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ fieldSlot: 1, giftSlot: 2 }),
      expect.objectContaining({ session }),
    );
  });

  it("does not report a reservation from a rolled-back transaction attempt", async () => {
    assets.find
      .mockReturnValueOnce({
        sort: () => ({ toArray: () => Promise.resolve([]) }),
        toArray: () => Promise.resolve([]),
      })
      .mockReturnValueOnce({
        sort: () => ({ toArray: () => Promise.resolve([]) }),
        toArray: () =>
          Promise.resolve(
            Array.from({ length: 12 }, (_, slot) => ({
              fieldId: baseAsset.fieldId,
              fieldSlot: slot,
              giftSlot: slot,
            })),
          ),
      });
    session.withTransaction.mockImplementationOnce(async (callback: () => Promise<void>) => {
      await callback();
      await callback();
    });

    await expect(mongoMediaAssetRepository.createWithinQuota(baseAsset, 30, 12)).resolves.toBe(
      false,
    );
  });

  it("uses transactions when enqueueing initial and retried processing", async () => {
    assets.findOneAndUpdate
      .mockResolvedValueOnce(document("uploaded"))
      .mockResolvedValueOnce(document("uploaded"))
      .mockResolvedValueOnce(document("deleting"));

    await expect(
      mongoMediaAssetRepository.markUploadedAndEnqueue(baseAsset.id, now),
    ).resolves.toMatchObject({ status: "uploaded" });
    await expect(mongoMediaAssetRepository.requeue(baseAsset.id, now)).resolves.toMatchObject({
      status: "uploaded",
    });
    await expect(mongoMediaAssetRepository.markDeleting(baseAsset.id, now)).resolves.toMatchObject({
      status: "deleting",
    });
    expect(jobs.insertOne).toHaveBeenCalledTimes(2);
    expect(session.withTransaction).toHaveBeenCalledTimes(2);
  });

  it("claims, completes, retries and cleans durable worker jobs", async () => {
    const job = {
      _id: "job-1",
      attempts: 1,
      availableAt: now,
      createdAt: now,
      deduplicationKey: `media.process.v1:${baseAsset.id}:0`,
      payload: { assetId: baseAsset.id },
      status: "processing",
      type: "media.process.v1",
      updatedAt: now,
    };
    jobs.findOneAndUpdate.mockResolvedValue(job);
    assets.findOneAndUpdate
      .mockResolvedValueOnce(document("deleting"))
      .mockResolvedValueOnce({ ...document("processing"), attempts: 1 });

    await expect(mongoMediaWorkerRepository.claimExpiredUpload(now)).resolves.toMatchObject({
      status: "deleting",
    });
    await expect(mongoMediaWorkerRepository.claimNext(now)).resolves.toMatchObject({
      jobId: "job-1",
    });
    await expect(
      mongoMediaWorkerRepository.complete(
        baseAsset.id,
        "job-1",
        {
          checksumSha256: "a".repeat(64),
          derivatives: [
            { contentType: "image/webp", height: 10, key: "private/w320.webp", width: 10 },
          ],
          placeholderDataUrl: "data:image/webp;base64,eA==",
        },
        now,
      ),
    ).resolves.toBeUndefined();
    await expect(
      mongoMediaWorkerRepository.fail(
        baseAsset.id,
        "job-1",
        "PROCESSING_FAILED",
        new Date(now.getTime() + 30_000),
        now,
      ),
    ).resolves.toBeUndefined();
    await expect(
      mongoMediaWorkerRepository.finishExpiredCleanup(baseAsset.id, now),
    ).resolves.toBeUndefined();
    await expect(
      mongoMediaWorkerRepository.failExpiredCleanup(baseAsset.id, now),
    ).resolves.toBeUndefined();
    expect(client.withSession).toHaveBeenCalledTimes(3);
  });

  it("does not return a claim from a rolled-back transaction attempt", async () => {
    const exhaustedJob = {
      _id: "job-exhausted",
      attempts: 3,
      payload: { assetId: baseAsset.id },
      status: "failed",
      type: "media.process.v1",
    };
    jobs.findOneAndUpdate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(exhaustedJob)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    assets.findOneAndUpdate.mockResolvedValueOnce({
      ...document("failed"),
      attempts: 3,
      failureCode: "PROCESSING_FAILED",
    });
    session.withTransaction.mockImplementationOnce(async (callback: () => Promise<void>) => {
      await callback();
      await callback();
    });

    await expect(mongoMediaWorkerRepository.claimNext(now)).resolves.toBeNull();
  });

  it("terminally fails a stale worker lease after the attempt budget is exhausted", async () => {
    const exhaustedJob = {
      _id: "job-exhausted",
      attempts: 3,
      availableAt: now,
      createdAt: now,
      deduplicationKey: `media.process.v1:${baseAsset.id}:0`,
      payload: { assetId: baseAsset.id },
      status: "failed",
      type: "media.process.v1",
      updatedAt: now,
    };
    jobs.findOneAndUpdate.mockResolvedValueOnce(null).mockResolvedValueOnce(exhaustedJob);
    assets.findOneAndUpdate.mockResolvedValueOnce({
      ...document("failed"),
      attempts: 3,
      failureCode: "PROCESSING_FAILED",
    });

    await expect(mongoMediaWorkerRepository.claimNext(now)).resolves.toMatchObject({
      exhaustedAsset: { failureCode: "PROCESSING_FAILED", id: baseAsset.id, status: "failed" },
    });
    expect(assets.findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: baseAsset.id, status: "processing" },
      { $set: { failureCode: "PROCESSING_FAILED", status: "failed", updatedAt: now } },
      { returnDocument: "after", session },
    );
  });
});
