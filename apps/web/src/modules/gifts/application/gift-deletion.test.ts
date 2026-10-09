import { type Gift, type MediaAsset } from "@love-memory/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { JobFailure } from "@/modules/jobs/application/job-registry";

import {
  createGiftDeletionHandler,
  type GiftAssetPurgeRepository,
  type GiftDeletionRepository,
} from "./gift-deletion";

const now = new Date("2026-10-10T12:00:00.000Z");
const requestedAt = new Date("2026-10-10T11:00:00.000Z");
const giftId = "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89";

function deletingGift(overrides: Partial<Gift> = {}): Gift {
  return {
    access: { mode: "unlisted" },
    content: {
      data: { receiver: "Minh Thư" },
      schemaVersion: 1,
      templateId: "memory-box",
      templateVersion: "1.1.0",
    },
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    deletionRequestedAt: requestedAt,
    id: giftId,
    ownership: { anonymousDraftId: null, claimTokenHash: null, ownerId: "user-1" },
    publicId: "pub-1",
    publishedAt: new Date("2026-10-02T00:00:00.000Z"),
    revision: 3,
    shareId: "Ab0_-cdefghijklmnopqrs",
    status: "deleting",
    updatedAt: requestedAt,
    ...overrides,
  };
}

function asset(id: string, status: MediaAsset["status"]): MediaAsset {
  return {
    derivatives: [{ key: `derived/${id}-640.webp` }, { key: `derived/${id}-1280.webp` }],
    id,
    sourceKey: `uploads/${id}`,
    status,
  } as unknown as MediaAsset;
}

describe("gift.delete.v1", () => {
  const findDeleting = vi.fn<GiftDeletionRepository["findDeleting"]>();
  const deleteDerived = vi.fn<GiftDeletionRepository["deleteDerived"]>();
  const purge = vi.fn<GiftDeletionRepository["purge"]>();
  const listForGift = vi.fn<GiftAssetPurgeRepository["listForGift"]>();
  const markGiftAssetDeleting = vi.fn<GiftAssetPurgeRepository["markGiftAssetDeleting"]>();
  const markDeleted = vi.fn<GiftAssetPurgeRepository["markDeleted"]>();
  const deleteObject = vi.fn<(key: string) => Promise<void>>();
  const deleteForGift = vi.fn<(giftId: string) => Promise<void>>();
  const handler = createGiftDeletionHandler({
    analytics: { deleteForGift },
    assets: { listForGift, markDeleted, markGiftAssetDeleting },
    gifts: { deleteDerived, findDeleting, purge },
    storage: { deleteObject },
  });
  const run = () => handler.run({ giftId }, { jobId: "job-1", now });

  beforeEach(() => {
    vi.clearAllMocks();
    deleteObject.mockResolvedValue(undefined);
    markGiftAssetDeleting.mockResolvedValue(true);
    markDeleted.mockResolvedValue(true);
  });

  it("purges photos, derived records, events, then writes the tombstone (Purge of a published gift with photos)", async () => {
    findDeleting.mockResolvedValueOnce(deletingGift());
    listForGift.mockResolvedValueOnce([
      asset("a1", "ready"),
      asset("a2", "processing"),
      asset("a3", "deleted"),
    ]);

    await run();

    expect(markGiftAssetDeleting).toHaveBeenCalledTimes(2);
    expect(deleteObject.mock.calls.map(([key]) => key)).toEqual([
      "uploads/a1",
      "derived/a1-640.webp",
      "derived/a1-1280.webp",
      "uploads/a2",
      "derived/a2-640.webp",
      "derived/a2-1280.webp",
    ]);
    expect(markDeleted).toHaveBeenCalledWith("a1", now);
    expect(markDeleted).toHaveBeenCalledWith("a2", now);
    expect(deleteDerived).toHaveBeenCalledWith(giftId, "job-1");
    expect(deleteForGift).toHaveBeenCalledWith(giftId);
    expect(purge).toHaveBeenCalledWith({
      photos: 3,
      published: true,
      tombstone: {
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
        deletedAt: now,
        deletionRequestedAt: requestedAt,
        expiresAt: new Date("2027-10-10T12:00:00.000Z"),
        id: giftId,
        ownerId: "user-1",
        publicId: "pub-1",
        publishedAt: new Date("2026-10-02T00:00:00.000Z"),
      },
    });
    // No content, share id or photo reference leaves the handler.
    expect(JSON.stringify(purge.mock.calls)).not.toMatch(/Minh Thư|Ab0_-|uploads\//);
  });

  it("retries on a storage failure without writing the tombstone (Storage failure is retried)", async () => {
    findDeleting.mockResolvedValueOnce(deletingGift());
    listForGift.mockResolvedValueOnce([asset("a1", "ready"), asset("a2", "ready")]);
    deleteObject.mockRejectedValueOnce(new Error("blob down"));

    const failure = await run().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(JobFailure);
    expect(failure).toMatchObject({ code: "STORAGE_DELETE_FAILED", retryable: true });
    expect(markDeleted).toHaveBeenCalledTimes(1);
    expect(markDeleted).toHaveBeenCalledWith("a2", now);
    expect(purge).not.toHaveBeenCalled();
    expect(deleteDerived).not.toHaveBeenCalled();
  });

  it("finishes a photo left deleting and skips one taken by another worker", async () => {
    findDeleting.mockResolvedValueOnce(deletingGift({ publishedAt: undefined }));
    listForGift.mockResolvedValueOnce([asset("a1", "deleting"), asset("a2", "ready")]);
    markGiftAssetDeleting.mockResolvedValueOnce(false);

    await run();

    expect(markGiftAssetDeleting).toHaveBeenCalledTimes(1);
    expect(markDeleted).toHaveBeenCalledTimes(1);
    expect(markDeleted).toHaveBeenCalledWith("a1", now);
    expect(purge).toHaveBeenCalledWith(
      expect.objectContaining({
        published: false,
        tombstone: expect.objectContaining({ publishedAt: null }) as unknown,
      }),
    );
  });

  it("does nothing for a gift that is not deleting (Job for a gift already purged)", async () => {
    findDeleting.mockResolvedValueOnce(null);

    await run();

    expect(listForGift).not.toHaveBeenCalled();
    expect(purge).not.toHaveBeenCalled();
  });

  it("runs as gift.delete.v1 with 8 attempts and refuses a malformed payload", () => {
    expect(handler.type).toBe("gift.delete.v1");
    expect(handler.maxAttempts).toBe(8);
    expect(handler.payload.safeParse({ giftId: "x" }).success).toBe(false);
  });
});
