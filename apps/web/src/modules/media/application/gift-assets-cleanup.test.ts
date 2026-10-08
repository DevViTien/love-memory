import { type Gift, type GiftPublication, type MediaAsset } from "@love-memory/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { JobFailure } from "@/modules/jobs/application/job-registry";

import {
  createGiftAssetsCleanupHandler,
  type DetachedAssetRepository,
  GIFT_ASSETS_CLEANUP_JOB,
  giftAssetsCleanupKey,
} from "./gift-assets-cleanup";

const now = new Date("2026-10-08T10:00:00.000Z");
const giftId = "3d594650-3436-4ca1-8a1a-5fc8a10bd154";
const kept = "550e8400-e29b-41d4-a716-446655440000";
const replaced = "550e8400-e29b-41d4-a716-446655440001";
const other = "550e8400-e29b-41d4-a716-446655440002";

function detached(id: string): MediaAsset {
  return {
    anonymousDraftId: null,
    attempts: 1,
    checksumSha256: "a".repeat(64),
    createdAt: now,
    declaredContentType: "image/jpeg",
    declaredSizeBytes: 3,
    derivatives: [
      { contentType: "image/webp", height: 10, key: `private/${id}/w320.webp`, width: 10 },
      { contentType: "image/webp", height: 20, key: `private/${id}/w768.webp`, width: 20 },
    ],
    detachedAt: now,
    expiresAt: null,
    failureCode: null,
    fieldId: "memories",
    fieldSlot: null,
    giftId,
    giftSlot: null,
    id,
    ownerId: "user-1",
    placeholderDataUrl: null,
    sourceKey: `private/${id}/source`,
    status: "ready",
    updatedAt: now,
  };
}

describe("gift assets cleanup job", () => {
  let gift: Gift | null;
  let publication: GiftPublication | null;
  let listed: MediaAsset[];
  let listDetachedReady: ReturnType<typeof vi.fn<DetachedAssetRepository["listDetachedReady"]>>;
  let markDetachedDeleting: ReturnType<
    typeof vi.fn<DetachedAssetRepository["markDetachedDeleting"]>
  >;
  let markDeleted: ReturnType<typeof vi.fn<DetachedAssetRepository["markDeleted"]>>;
  let deleteObject: ReturnType<typeof vi.fn<(key: string) => Promise<void>>>;

  beforeEach(() => {
    gift = { id: giftId, publishedRevision: 9, status: "published" } as Gift;
    publication = { assetIds: [kept], giftId, revision: 9 } as unknown as GiftPublication;
    listed = [detached(kept), detached(replaced)];
    listDetachedReady = vi.fn(() => Promise.resolve(listed));
    markDeleted = vi.fn(() => Promise.resolve(true));
    markDetachedDeleting = vi.fn(() => Promise.resolve(true));
    deleteObject = vi.fn(() => Promise.resolve());
  });

  function handler() {
    return createGiftAssetsCleanupHandler({
      assets: { listDetachedReady, markDeleted, markDetachedDeleting },
      gifts: { findEditableById: () => Promise.resolve(gift) },
      publications: { findByGiftRevision: () => Promise.resolve(publication) },
      storage: { deleteObject },
    });
  }

  const run = () => handler().run({ giftId }, { jobId: "job-1", now });

  it("is the registered type with a budget of 5, keyed per gift and revision", () => {
    expect(handler()).toMatchObject({ maxAttempts: 5, type: GIFT_ASSETS_CLEANUP_JOB });
    expect(GIFT_ASSETS_CLEANUP_JOB).toBe("gift.assets.cleanup.v1");
    expect(giftAssetsCleanupKey(giftId, 9)).toBe(`gift.assets.cleanup.v1:${giftId}:9`);
    expect(handler().payload.safeParse({ giftId }).success).toBe(true);
    expect(handler().payload.safeParse({ giftId, extra: 1 }).success).toBe(false);
  });

  it("deletes the detached photo the update replaced (Replaced photo deleted after the update)", async () => {
    await run();

    expect(markDetachedDeleting).toHaveBeenCalledExactlyOnceWith(replaced, giftId, now);
    expect(deleteObject.mock.calls.map(([key]) => key)).toEqual([
      `private/${replaced}/source`,
      `private/${replaced}/w320.webp`,
      `private/${replaced}/w768.webp`,
    ]);
    expect(markDeleted).toHaveBeenCalledExactlyOnceWith(replaced, now);
  });

  it("keeps a detached photo the current publication still shows (Photo still in the current publication)", async () => {
    listed = [detached(kept)];

    await run();

    expect(markDetachedDeleting).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("finishes the other photos, then fails retryably (Storage removal fails)", async () => {
    listed = [detached(replaced), detached(other)];
    deleteObject.mockImplementation((key) =>
      key === `private/${replaced}/w768.webp`
        ? Promise.reject(new Error("blob"))
        : Promise.resolve(),
    );

    const failure = await run().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(JobFailure);
    expect(failure).toMatchObject({ code: "STORAGE_DELETE_FAILED", retryable: true });
    expect(markDeleted).toHaveBeenCalledExactlyOnceWith(other, now);
  });

  it("does nothing for a gift that is gone or not published (Gift gone)", async () => {
    gift = null;
    await expect(run()).resolves.toBeUndefined();
    gift = { id: giftId, status: "draft" } as Gift;
    await expect(run()).resolves.toBeUndefined();
    expect(listDetachedReady).not.toHaveBeenCalled();
  });

  it("fails retryably without touching anything when the current publication is unreadable", async () => {
    publication = null;

    await expect(run()).rejects.toMatchObject({ code: "PUBLICATION_UNREADABLE", retryable: true });
    expect(listDetachedReady).not.toHaveBeenCalled();
  });

  it("skips a photo another worker already took", async () => {
    markDetachedDeleting.mockResolvedValue(false);

    await run();

    expect(deleteObject).not.toHaveBeenCalled();
    expect(markDeleted).not.toHaveBeenCalled();
  });

  it("finds nothing to do on a second run", async () => {
    await run();
    listed = [detached(kept)];
    vi.clearAllMocks();

    await run();

    expect(markDetachedDeleting).not.toHaveBeenCalled();
  });
});
