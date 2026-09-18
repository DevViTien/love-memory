import { type Gift, type MediaAsset } from "@love-memory/domain";
import { ObjectNotFoundError, type ObjectStorage } from "@love-memory/storage";
import { parseTemplateManifest } from "@love-memory/template-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMediaService, type MediaAssetRepository } from "./media-service";

const now = new Date("2026-09-17T00:00:00.000Z");
const gift: Gift = {
  access: { mode: "unlisted" },
  content: { data: {}, schemaVersion: 1, templateId: "memory-box", templateVersion: "1.0.0" },
  createdAt: now,
  id: "3d594650-3436-4ca1-8a1a-5fc8a10bd154",
  ownership: { anonymousDraftId: null, claimTokenHash: null, ownerId: "user-1" },
  publicId: "abcdefghijklmnop",
  revision: 0,
  status: "draft",
  updatedAt: now,
};
const manifest = parseTemplateManifest({
  budgets: { initialJsKbGzip: 10, initialMediaKb: 0, maxTextureMb: 4 },
  capabilities: ["dom"],
  engineVersion: "1.0.0",
  entry: "index.html",
  fields: [
    {
      aspectRatio: "4:3",
      id: "photos",
      label: "Photos",
      maxItems: 2,
      minItems: 1,
      required: true,
      type: "imageList",
    },
  ],
  id: "memory-box",
  meta: {
    description: "A memory box",
    estimatedDurationSec: 5,
    moods: ["warm"],
    name: "Memory Box",
    occasions: ["anniversary"],
  },
  previewFixture: "fixture.json",
  status: "published",
  version: "1.0.0",
});

function asset(status: MediaAsset["status"] = "initiated"): MediaAsset {
  return {
    anonymousDraftId: null,
    attempts: 0,
    checksumSha256: null,
    createdAt: now,
    declaredContentType: "image/jpeg",
    declaredSizeBytes: 3,
    derivatives: [],
    expiresAt: new Date(now.getTime() + 600_000),
    failureCode: status === "failed" ? "PROCESSING_FAILED" : null,
    fieldId: "photos",
    fieldSlot: 0,
    giftId: gift.id,
    giftSlot: 0,
    id: "550e8400-e29b-41d4-a716-446655440000",
    ownerId: "user-1",
    placeholderDataUrl: null,
    sourceKey: "private/assets/550e8400-e29b-41d4-a716-446655440000/source",
    status,
    updatedAt: now,
  };
}

describe("media service", () => {
  let current: MediaAsset | null;
  let repository: MediaAssetRepository;
  let storage: ObjectStorage;

  beforeEach(() => {
    current = null;
    repository = {
      createWithinQuota: vi.fn<MediaAssetRepository["createWithinQuota"]>((value) => {
        current = value;
        return Promise.resolve(true);
      }),
      findById: vi.fn(() => Promise.resolve(current)),
      listByGiftId: vi.fn(() => Promise.resolve(current ? [current] : [])),
      releaseInitiated: vi.fn<MediaAssetRepository["releaseInitiated"]>((id) => {
        if (current?.id !== id || current.status !== "initiated") return Promise.resolve(false);
        current = { ...current, expiresAt: null, status: "deleted" };
        return Promise.resolve(true);
      }),
      markDeleted: vi.fn(() => Promise.resolve(true)),
      markDeleting: vi.fn<MediaAssetRepository["markDeleting"]>(() =>
        Promise.resolve(current ? { ...current, status: "deleting" as const } : null),
      ),
      markFailed: vi.fn<MediaAssetRepository["markFailed"]>((id, failureCode) => {
        if (current?.id !== id || current.status !== "initiated") return Promise.resolve(false);
        current = { ...current, failureCode, status: "failed" };
        return Promise.resolve(true);
      }),
      markUploadedAndEnqueue: vi.fn(() => {
        current = current ? { ...current, expiresAt: null, status: "uploaded" } : null;
        return Promise.resolve(current);
      }),
      requeue: vi.fn(() => {
        current = current ? { ...current, failureCode: null, status: "uploaded" } : null;
        return Promise.resolve(current);
      }),
    };
    storage = {
      createDownloadUrl: vi.fn((key) => Promise.resolve(`https://cdn.example/${key}`)),
      createUpload: vi.fn<ObjectStorage["createUpload"]>(() =>
        Promise.resolve({
          expiresAt: new Date(now.getTime() + 600_000),
          headers: { "content-type": "image/jpeg" },
          method: "PUT" as const,
          url: "https://upload.example/source",
        }),
      ),
      deleteObject: vi.fn(() => Promise.resolve()),
      getObject: vi.fn(() => Promise.resolve(Uint8Array.from([1, 2, 3]))),
      getObjectMetadata: vi.fn(() =>
        Promise.resolve({ contentLength: 3, contentType: "image/jpeg" }),
      ),
      putObject: vi.fn(() => Promise.resolve()),
    };
  });

  function service(authorize = true) {
    return createMediaService({
      assets: repository,
      authorizeGift: () => Promise.resolve(authorize ? gift : null),
      clock: () => now,
      createId: () => "550e8400-e29b-41d4-a716-446655440000",
      findManifest: () => Promise.resolve(manifest),
      storage,
    });
  }

  it("creates a private, gift-bound direct upload grant", async () => {
    const result = await service().initializeUpload({
      accessors: [],
      contentType: "image/jpeg",
      fieldId: "photos",
      giftPublicId: gift.publicId,
      sizeBytes: 3,
    });
    expect(result).toMatchObject({
      data: { assetId: "550e8400-e29b-41d4-a716-446655440000", method: "PUT" },
      ok: true,
    });
    expect(current).toMatchObject({ giftId: gift.id, ownerId: "user-1", status: "initiated" });
    expect(vi.mocked(storage.createUpload).mock.calls[0]?.[0].key).toContain("private/assets/");
  });

  it("releases the quota reservation when Blob cannot create an upload grant", async () => {
    vi.mocked(storage.createUpload).mockRejectedValueOnce(new Error("Blob unavailable"));

    await expect(
      service().initializeUpload({
        accessors: [],
        contentType: "image/jpeg",
        fieldId: "photos",
        giftPublicId: gift.publicId,
        sizeBytes: 3,
      }),
    ).rejects.toThrow("Blob unavailable");
    expect(repository.releaseInitiated).toHaveBeenCalledWith(
      "550e8400-e29b-41d4-a716-446655440000",
      now,
    );
    expect(current?.status).toBe("deleted");
  });

  it("hides unauthorized gifts and enforces manifest field quotas", async () => {
    await expect(
      service(false).initializeUpload({
        accessors: [],
        contentType: "image/jpeg",
        fieldId: "photos",
        giftPublicId: gift.publicId,
        sizeBytes: 3,
      }),
    ).resolves.toEqual({ error: { code: "NOT_FOUND" }, ok: false });
    vi.mocked(repository.createWithinQuota).mockResolvedValue(false);
    await expect(
      service().initializeUpload({
        accessors: [],
        contentType: "image/jpeg",
        fieldId: "photos",
        giftPublicId: gift.publicId,
        sizeBytes: 3,
      }),
    ).resolves.toEqual({ error: { code: "QUOTA_EXCEEDED" }, ok: false });
  });

  it("verifies object metadata before atomically enqueueing processing", async () => {
    current = asset();
    await expect(
      service().completeUpload({ accessors: [], assetId: current.id, giftPublicId: gift.publicId }),
    ).resolves.toMatchObject({ data: { status: "uploaded" }, ok: true });
    expect(repository.markUploadedAndEnqueue).toHaveBeenCalledOnce();

    current = asset();
    vi.mocked(storage.getObjectMetadata).mockResolvedValue({
      contentLength: 4,
      contentType: "image/jpeg",
    });
    await expect(
      service().completeUpload({ accessors: [], assetId: current.id, giftPublicId: gift.publicId }),
    ).resolves.toEqual({ error: { code: "UPLOAD_INVALID" }, ok: false });
    expect(storage.deleteObject).toHaveBeenCalled();
  });

  it("keeps an initiated upload retryable when Blob metadata is temporarily unavailable", async () => {
    current = asset();
    vi.mocked(storage.getObjectMetadata).mockRejectedValueOnce(new Error("Blob timeout"));

    await expect(
      service().completeUpload({ accessors: [], assetId: current.id, giftPublicId: gift.publicId }),
    ).rejects.toThrow("Blob timeout");
    expect(repository.markFailed).not.toHaveBeenCalled();

    vi.mocked(storage.getObjectMetadata).mockRejectedValueOnce(
      new ObjectNotFoundError("Object missing"),
    );
    await expect(
      service().completeUpload({ accessors: [], assetId: current.id, giftPublicId: gift.publicId }),
    ).resolves.toEqual({ error: { code: "UPLOAD_INVALID" }, ok: false });
    expect(repository.markFailed).toHaveBeenCalledWith(current.id, "OBJECT_MISSING", now);
  });

  it("does not resurrect an asset when completion loses a race with deletion", async () => {
    current = asset();
    vi.mocked(repository.markFailed).mockResolvedValueOnce(false);
    vi.mocked(storage.getObjectMetadata).mockResolvedValueOnce({
      contentLength: 4,
      contentType: "image/jpeg",
    });

    await expect(
      service().completeUpload({ accessors: [], assetId: current.id, giftPublicId: gift.publicId }),
    ).resolves.toEqual({ error: { code: "INVALID_STATE" }, ok: false });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("returns only signed derivatives and supports bounded retries", async () => {
    current = {
      ...asset("ready"),
      checksumSha256: "a".repeat(64),
      derivatives: [
        { contentType: "image/webp", height: 240, key: "private/derivative.webp", width: 320 },
      ],
      placeholderDataUrl: "data:image/webp;base64,eA==",
    };
    const listed = await service().listAssets({ accessors: [], giftPublicId: gift.publicId });
    expect(listed).toMatchObject({
      data: [{ derivatives: [{ url: "https://cdn.example/private/derivative.webp" }] }],
      ok: true,
    });
    await expect(
      service().listAssets({
        accessors: [],
        giftPublicId: gift.publicId,
        includeDownloadUrls: false,
      }),
    ).resolves.toMatchObject({ data: [{ derivatives: [] }], ok: true });
    expect(storage.createDownloadUrl).toHaveBeenCalledTimes(1);

    current = { ...asset("failed"), attempts: 3 };
    await expect(
      service().retryAsset({ accessors: [], assetId: current.id, giftPublicId: gift.publicId }),
    ).resolves.toEqual({ error: { code: "RETRY_EXHAUSTED" }, ok: false });

    current = { ...asset("failed"), failureCode: "UPLOAD_INVALID" };
    await expect(
      service().retryAsset({ accessors: [], assetId: current.id, giftPublicId: gift.publicId }),
    ).resolves.toEqual({ error: { code: "INVALID_STATE" }, ok: false });
  });

  it("cleans every private object before tombstoning an asset", async () => {
    current = {
      ...asset("ready"),
      checksumSha256: "b".repeat(64),
      derivatives: [
        { contentType: "image/webp", height: 10, key: "private/derived.webp", width: 10 },
      ],
    };
    await expect(
      service().deleteAsset({ accessors: [], assetId: current.id, giftPublicId: gift.publicId }),
    ).resolves.toEqual({ data: { assetId: current.id, deleted: true }, ok: true });
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
    expect(repository.markDeleted).toHaveBeenCalledOnce();
  });

  it("keeps cleanup failures in deleting state so delete can be retried", async () => {
    current = asset("ready");
    vi.mocked(storage.deleteObject).mockRejectedValueOnce(new Error("temporary Blob failure"));

    await expect(
      service().deleteAsset({ accessors: [], assetId: current.id, giftPublicId: gift.publicId }),
    ).rejects.toThrow(AggregateError);
    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(repository.markDeleted).not.toHaveBeenCalled();
  });

  it("does not report deletion success when the tombstone transition loses a race", async () => {
    current = asset("ready");
    vi.mocked(repository.markDeleted).mockResolvedValueOnce(false);

    await expect(
      service().deleteAsset({ accessors: [], assetId: current.id, giftPublicId: gift.publicId }),
    ).resolves.toEqual({ error: { code: "INVALID_STATE" }, ok: false });
  });
});
