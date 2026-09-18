import { type MediaAsset } from "@love-memory/domain";
import { InvalidImageError, type processUploadedImageSet } from "@love-memory/media";
import { type ObjectStorage } from "@love-memory/storage";
import { describe, expect, it, vi } from "vitest";

import { createMediaWorker, type MediaWorkerRepository } from "./media-worker";

const asset: MediaAsset = {
  anonymousDraftId: null,
  attempts: 0,
  checksumSha256: null,
  createdAt: new Date(0),
  declaredContentType: "image/jpeg",
  declaredSizeBytes: 3,
  derivatives: [],
  expiresAt: null,
  failureCode: null,
  fieldId: "photos",
  fieldSlot: 0,
  giftId: "3d594650-3436-4ca1-8a1a-5fc8a10bd154",
  giftSlot: 0,
  id: "550e8400-e29b-41d4-a716-446655440000",
  ownerId: "user-1",
  placeholderDataUrl: null,
  sourceKey: "private/source",
  status: "processing",
  updatedAt: new Date(0),
};

function repository(claimed = true): MediaWorkerRepository {
  return {
    claimNext: vi.fn(() => Promise.resolve(claimed ? { asset, jobId: "job-1" } : null)),
    claimExpiredUpload: vi.fn(() => Promise.resolve(null)),
    complete: vi.fn(() => Promise.resolve()),
    fail: vi.fn(() => Promise.resolve()),
    failExpiredCleanup: vi.fn(() => Promise.resolve()),
    finishExpiredCleanup: vi.fn(() => Promise.resolve()),
  };
}

function storage(): ObjectStorage {
  return {
    createDownloadUrl: vi.fn(),
    createUpload: vi.fn(),
    deleteObject: vi.fn(() => Promise.resolve()),
    getObject: vi.fn(() => Promise.resolve(Uint8Array.from([1, 2, 3]))),
    getObjectMetadata: vi.fn(),
    putObject: vi.fn(() => Promise.resolve()),
  };
}

describe("media worker", () => {
  it("drains a bounded batch so an older failure cannot starve a new upload", async () => {
    const repo = repository();
    vi.mocked(repo.claimNext)
      .mockResolvedValueOnce({ asset, jobId: "job-1" })
      .mockResolvedValueOnce({ asset, jobId: "job-2" })
      .mockResolvedValue(null);
    const worker = createMediaWorker({
      processImage: vi.fn<typeof processUploadedImageSet>(() =>
        Promise.resolve({
          checksumSha256: "a".repeat(64),
          derivatives: [],
          placeholderDataUrl: "data:image/webp;base64,",
          sourceContentType: "image/jpeg" as const,
        }),
      ),
      repository: repo,
      storage: storage(),
    });

    await expect(worker.runAvailable(3)).resolves.toHaveLength(2);
    expect(repo.complete).toHaveBeenCalledTimes(2);
    await expect(worker.runAvailable(0)).rejects.toThrow(RangeError);
  });

  it("is idle without a durable outbox job", async () => {
    await expect(
      createMediaWorker({ repository: repository(false), storage: storage() }).runNext(),
    ).resolves.toEqual({ status: "idle" });
  });

  it("writes every derivative, commits metadata, then removes the source", async () => {
    const repo = repository();
    const objects = storage();
    const worker = createMediaWorker({
      clock: () => new Date("2026-09-17T00:00:00.000Z"),
      processImage: vi.fn<typeof processUploadedImageSet>(() =>
        Promise.resolve({
          checksumSha256: "a".repeat(64),
          derivatives: [
            {
              bytes: Uint8Array.from([4]),
              contentType: "image/webp" as const,
              height: 240,
              sourceContentType: "image/jpeg" as const,
              targetWidth: 320,
              width: 320,
            },
          ],
          placeholderDataUrl: "data:image/webp;base64,BA==",
          sourceContentType: "image/jpeg" as const,
        }),
      ),
      repository: repo,
      storage: objects,
    });
    await expect(worker.runNext()).resolves.toEqual({ assetId: asset.id, status: "completed" });
    expect(vi.mocked(objects.putObject).mock.calls[0]?.[0].key).toContain("w320.webp");
    expect(repo.complete).toHaveBeenCalledBefore(vi.mocked(objects.deleteObject));
  });

  it("rejects decoded MIME spoofing and records processing failures for retry", async () => {
    const spoofRepo = repository();
    const spoofStorage = storage();
    const spoof = createMediaWorker({
      processImage: vi.fn<typeof processUploadedImageSet>(() =>
        Promise.resolve({
          checksumSha256: "a".repeat(64),
          derivatives: [],
          placeholderDataUrl: "data:image/webp;base64,",
          sourceContentType: "image/png" as const,
        }),
      ),
      repository: spoofRepo,
      storage: spoofStorage,
    });
    await expect(spoof.runNext()).resolves.toMatchObject({ status: "failed" });
    expect(spoofRepo.fail).toHaveBeenCalledWith(
      asset.id,
      "job-1",
      "UPLOAD_INVALID",
      null,
      expect.any(Date),
    );

    const failedRepo = repository();
    const reportProcessingFailure = vi.fn();
    const decodeError = new Error("decode");
    const failed = createMediaWorker({
      processImage: vi.fn<typeof processUploadedImageSet>(() => Promise.reject(decodeError)),
      reportProcessingFailure,
      repository: failedRepo,
      storage: storage(),
    });
    await expect(failed.runNext()).resolves.toMatchObject({ status: "failed" });
    expect(failedRepo.fail).toHaveBeenCalledWith(
      asset.id,
      "job-1",
      "PROCESSING_FAILED",
      expect.any(Date),
      expect.any(Date),
    );
    expect(reportProcessingFailure).toHaveBeenCalledWith(decodeError, asset.id);
  });

  it("does not retry invalid decoded bytes", async () => {
    const repo = repository();
    const objects = storage();
    const decodeError = new InvalidImageError("invalid bytes");
    const worker = createMediaWorker({
      processImage: vi.fn<typeof processUploadedImageSet>(() => Promise.reject(decodeError)),
      repository: repo,
      storage: objects,
    });

    await expect(worker.runNext()).resolves.toMatchObject({ status: "failed" });
    expect(repo.fail).toHaveBeenCalledWith(
      asset.id,
      "job-1",
      "DECODE_FAILED",
      null,
      expect.any(Date),
    );
    expect(objects.deleteObject).toHaveBeenCalledWith(asset.sourceKey);
  });

  it("removes written derivatives when the ready-state commit loses a race", async () => {
    const repo = repository();
    vi.mocked(repo.complete).mockRejectedValue(new Error("asset was deleted"));
    const objects = storage();
    vi.mocked(objects.deleteObject).mockImplementation((key) =>
      key.endsWith("w768.webp")
        ? Promise.reject(new Error("temporary Blob failure"))
        : Promise.resolve(),
    );
    const reportCleanupFailure = vi.fn();
    const worker = createMediaWorker({
      processImage: vi.fn<typeof processUploadedImageSet>(() =>
        Promise.resolve({
          checksumSha256: "a".repeat(64),
          derivatives: [
            {
              bytes: Uint8Array.from([4]),
              contentType: "image/webp" as const,
              height: 240,
              sourceContentType: "image/jpeg" as const,
              targetWidth: 320,
              width: 320,
            },
            {
              bytes: Uint8Array.from([5]),
              contentType: "image/webp" as const,
              height: 576,
              sourceContentType: "image/jpeg" as const,
              targetWidth: 768,
              width: 768,
            },
          ],
          placeholderDataUrl: "data:image/webp;base64,BA==",
          sourceContentType: "image/jpeg" as const,
        }),
      ),
      reportCleanupFailure,
      repository: repo,
      storage: objects,
    });

    await expect(worker.runNext()).resolves.toMatchObject({ status: "failed" });
    expect(objects.deleteObject).toHaveBeenCalledWith(
      `private/assets/${asset.id}/derivatives/w320.webp`,
    );
    expect(reportCleanupFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: "temporary Blob failure" }),
      asset.id,
    );
    expect(repo.fail).toHaveBeenCalledOnce();
  });

  it("cleans abandoned direct uploads without processing their bytes", async () => {
    const repo = repository(false);
    vi.mocked(repo.claimExpiredUpload).mockResolvedValue({
      ...asset,
      derivatives: [
        { contentType: "image/webp", height: 240, key: "private/derivative.webp", width: 320 },
      ],
      expiresAt: new Date(0),
      status: "deleting",
    });
    const objects = storage();
    await expect(
      createMediaWorker({ repository: repo, storage: objects }).runNext(),
    ).resolves.toEqual({ assetId: asset.id, status: "cleaned" });
    expect(objects.deleteObject).toHaveBeenCalledWith(asset.sourceKey);
    expect(objects.deleteObject).toHaveBeenCalledWith("private/derivative.webp");
    expect(repo.finishExpiredCleanup).toHaveBeenCalledOnce();
  });
});
