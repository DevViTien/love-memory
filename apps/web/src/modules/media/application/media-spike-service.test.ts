import { type ObjectStorage } from "@love-memory/storage";
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
      expect.objectContaining({ key: `processed/spikes/${assetId}/w768.webp` }),
    );
    expect(storage.deleteObject).toHaveBeenCalledWith(`private/spikes/${assetId}/source`);
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
