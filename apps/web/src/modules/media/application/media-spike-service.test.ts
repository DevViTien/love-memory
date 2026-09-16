import { ObjectNotFoundError, type ObjectStorage } from "@love-memory/storage";
import { describe, expect, it, vi } from "vitest";

import { createMediaSpikeService, UploadVerificationError } from "./media-spike-service";

const assetId = "550e8400-e29b-41d4-a716-446655440000";

function createStorage(overrides: Partial<ObjectStorage> = {}): ObjectStorage {
  return {
    createDownloadUrl: vi.fn(() =>
      Promise.resolve("https://store.private.blob.vercel-storage.com/processed?signature=test"),
    ),
    createUpload: vi.fn(() =>
      Promise.resolve({
        expiresAt: new Date("2026-09-15T00:05:00.000Z"),
        headers: { "content-type": "image/jpeg" },
        method: "PUT" as const,
        url: "https://blob.vercel-storage.com/source?signature=test",
      }),
    ),
    deleteObject: vi.fn(() => Promise.resolve()),
    getObject: vi.fn(() => Promise.resolve(Uint8Array.from([1, 2, 3]))),
    getObjectMetadata: vi.fn(() =>
      Promise.resolve({
        contentLength: 3,
        contentType: "image/jpeg",
      }),
    ),
    putObject: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe("media spike service", () => {
  it("creates an identity-safe direct upload grant", async () => {
    const storage = createStorage();
    const service = createMediaSpikeService({ createId: () => assetId, storage });

    await expect(
      service.initializeUpload({
        contentType: "image/jpeg",
        fileName: "private-name.jpg",
        sizeBytes: 3,
      }),
    ).resolves.toMatchObject({ assetId, method: "PUT" });

    expect(storage.createUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `private/spikes/${assetId}/source`,
        maximumSizeInBytes: 3,
      }),
    );
  });

  it("verifies, processes and removes a source object", async () => {
    const storage = createStorage();
    const processImage = vi.fn(() =>
      Promise.resolve({
        bytes: Uint8Array.from([4, 5]),
        contentType: "image/webp" as const,
        height: 768,
        sourceContentType: "image/jpeg" as const,
        width: 512,
      }),
    );
    const service = createMediaSpikeService({ processImage, storage });

    await expect(service.completeUpload({ assetId })).resolves.toMatchObject({
      assetId,
      contentType: "image/webp",
      height: 768,
      width: 512,
    });
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        allowOverwrite: true,
        key: `processed/spikes/${assetId}/w768.webp`,
      }),
    );
    expect(storage.deleteObject).toHaveBeenCalledWith(`private/spikes/${assetId}/source`);
    expect(vi.mocked(storage.createDownloadUrl).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(storage.deleteObject).mock.invocationCallOrder[0]!,
    );
  });

  it("keeps the source retryable when signed URL creation fails", async () => {
    const storage = createStorage({
      createDownloadUrl: vi.fn(() => Promise.reject(new Error("signing unavailable"))),
    });
    const service = createMediaSpikeService({
      processImage: vi.fn(() =>
        Promise.resolve({
          bytes: Uint8Array.from([4, 5]),
          contentType: "image/webp" as const,
          height: 768,
          sourceContentType: "image/jpeg" as const,
          width: 512,
        }),
      ),
      storage,
    });

    await expect(service.completeUpload({ assetId })).rejects.toThrow("signing unavailable");
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({ allowOverwrite: true }),
    );
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("recovers a completed response when the source was already deleted", async () => {
    const storage = createStorage({
      getObjectMetadata: vi.fn(() => Promise.reject(new ObjectNotFoundError("missing source"))),
    });
    const processImage = vi.fn(() =>
      Promise.resolve({
        bytes: Uint8Array.from([4, 5]),
        contentType: "image/webp" as const,
        height: 768,
        sourceContentType: "image/webp" as const,
        width: 512,
      }),
    );
    const service = createMediaSpikeService({ processImage, storage });

    await expect(service.completeUpload({ assetId })).resolves.toMatchObject({
      assetId,
      height: 768,
      width: 512,
    });
    expect(storage.getObject).toHaveBeenCalledWith(
      `processed/spikes/${assetId}/w768.webp`,
      expect.any(Number),
    );
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("deletes both spike objects during explicit cleanup", async () => {
    const storage = createStorage();
    const service = createMediaSpikeService({ storage });

    await expect(service.cleanupUpload({ assetId })).resolves.toEqual({
      assetId,
      deleted: true,
    });
    expect(storage.deleteObject).toHaveBeenCalledWith(`private/spikes/${assetId}/source`);
    expect(storage.deleteObject).toHaveBeenCalledWith(`processed/spikes/${assetId}/w768.webp`);
  });

  it("attempts every cleanup even if one object deletion fails", async () => {
    const deleteObject = vi
      .fn<ObjectStorage["deleteObject"]>()
      .mockRejectedValueOnce(new Error("source cleanup failed"))
      .mockResolvedValueOnce();
    const service = createMediaSpikeService({ storage: createStorage({ deleteObject }) });

    await expect(service.cleanupUpload({ assetId })).rejects.toBeInstanceOf(AggregateError);
    expect(deleteObject).toHaveBeenCalledTimes(2);
  });

  it("deletes and rejects invalid object metadata", async () => {
    const storage = createStorage({
      getObjectMetadata: vi.fn(() =>
        Promise.resolve({
          contentLength: 4,
          contentType: "image/svg+xml",
        }),
      ),
    });
    const service = createMediaSpikeService({ storage });

    await expect(service.completeUpload({ assetId })).rejects.toBeInstanceOf(
      UploadVerificationError,
    );
    expect(storage.deleteObject).toHaveBeenCalledOnce();
  });

  it("rejects MIME spoofing after decoding", async () => {
    const storage = createStorage();
    const service = createMediaSpikeService({
      processImage: vi.fn(() =>
        Promise.resolve({
          bytes: Uint8Array.from([4]),
          contentType: "image/webp" as const,
          height: 1,
          sourceContentType: "image/png" as const,
          width: 1,
        }),
      ),
      storage,
    });

    await expect(service.completeUpload({ assetId })).rejects.toBeInstanceOf(
      UploadVerificationError,
    );
    expect(storage.deleteObject).toHaveBeenCalledWith(`private/spikes/${assetId}/source`);
  });
});
