import { parseStorageConfiguration, StorageConfigurationError } from "@love-memory/storage";
import { type MediaService } from "@/modules/media/application/media-service";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const helperMocks = vi.hoisted(() => ({
  enforce: vi.fn(() => Promise.resolve(null)),
  getContext: vi.fn(() =>
    Promise.resolve({ accessors: [], anonymousIdentity: null, userId: null }),
  ),
  requestId: vi.fn(() => "request-1"),
}));

vi.mock("@/modules/gifts/presentation/gift-route-helpers", () => ({
  enforceGiftMutationRateLimit: helperMocks.enforce,
  getGiftRequestContext: helperMocks.getContext,
  requestId: helperMocks.requestId,
}));

import {
  handleCompleteMediaUpload,
  handleDeleteMediaAsset,
  handleGetMediaAsset,
  handleInitializeMediaUpload,
  handleListMediaAssets,
  handleRetryMediaAsset,
} from "./media-route-handlers";

const assetId = "550e8400-e29b-41d4-a716-446655440000";
const giftPublicId = "abcdefghijklmnop";
const dto = {
  assetId,
  derivatives: [],
  failureCode: null,
  fieldId: "photos",
  placeholderDataUrl: null,
  status: "uploaded" as const,
};

function jsonRequest(path: string, body: unknown, method = "POST") {
  return new Request(`https://example.test${path}`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
}

describe("media route handlers", () => {
  let service: MediaService;
  let completeUploadMock: Mock<MediaService["completeUpload"]>;
  let initializeUploadMock: Mock<MediaService["initializeUpload"]>;
  let listAssetsMock: Mock<MediaService["listAssets"]>;
  const scheduleProcessing = vi.fn();
  const reportFailure = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    completeUploadMock = vi.fn<MediaService["completeUpload"]>(() =>
      Promise.resolve({ data: dto, ok: true }),
    );
    initializeUploadMock = vi.fn<MediaService["initializeUpload"]>(() =>
      Promise.resolve({
        data: {
          assetId,
          expiresAt: new Date(0).toISOString(),
          headers: { "content-type": "image/jpeg" },
          method: "PUT",
          url: "https://upload.example/source",
        },
        ok: true,
      }),
    );
    listAssetsMock = vi.fn<MediaService["listAssets"]>(() =>
      Promise.resolve({ data: [dto], ok: true }),
    );
    service = {
      completeUpload: completeUploadMock,
      deleteAsset: vi.fn<MediaService["deleteAsset"]>(() =>
        Promise.resolve({ data: { assetId, deleted: true }, ok: true }),
      ),
      getAsset: vi.fn<MediaService["getAsset"]>(() => Promise.resolve({ data: dto, ok: true })),
      initializeUpload: initializeUploadMock,
      listAssets: listAssetsMock,
      retryAsset: vi.fn<MediaService["retryAsset"]>(() => Promise.resolve({ data: dto, ok: true })),
    };
  });

  const dependencies = () => ({ getService: () => service, reportFailure, scheduleProcessing });

  it("validates and initializes a direct upload", async () => {
    const response = await handleInitializeMediaUpload(
      jsonRequest("/api/media/uploads/init", {
        contentType: "image/jpeg",
        fieldId: "photos",
        fileName: "memory.jpg",
        giftPublicId,
        sizeBytes: 3,
      }),
      dependencies(),
    );
    expect(response.status).toBe(201);
    expect(initializeUploadMock).toHaveBeenCalled();

    const invalid = await handleInitializeMediaUpload(
      new Request("https://example.test/api/media/uploads/init", { method: "POST" }),
      dependencies(),
    );
    expect(invalid.status).toBe(415);
  });

  it("answers 500 without reserving quota when the local storage driver is refused", async () => {
    const getService = vi.fn((): MediaService => {
      // What composition throws when STORAGE_DRIVER=local is refused on a Vercel deployment.
      parseStorageConfiguration(
        {
          APP_URL: "http://127.0.0.1:3100",
          LOCAL_OBJECT_STORAGE_SECRET: "refused-local-object-storage-secret",
          STORAGE_DRIVER: "local",
          VERCEL_ENV: "preview",
        },
        { workspaceRoot: "/workspace" },
      );
      return service;
    });
    const response = await handleInitializeMediaUpload(
      jsonRequest("/api/media/uploads/init", {
        contentType: "image/jpeg",
        fieldId: "photos",
        fileName: "memory.jpg",
        giftPublicId,
        sizeBytes: 3,
      }),
      { getService, reportFailure, scheduleProcessing },
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(getService).toHaveBeenCalledOnce();
    // The service (and with it the quota reservation) is never reached.
    expect(initializeUploadMock).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledWith(
      "media_upload_initialize_failed",
      expect.any(StorageConfigurationError),
      "request-1",
    );
  });

  it("enqueues completion and schedules the worker only after success", async () => {
    const response = await handleCompleteMediaUpload(
      jsonRequest("/api/media/uploads/complete", { assetId, giftPublicId }),
      dependencies(),
    );
    expect(response.status).toBe(202);
    expect(scheduleProcessing).toHaveBeenCalledExactlyOnceWith(assetId);

    completeUploadMock.mockResolvedValue({
      error: { code: "UPLOAD_INVALID" },
      ok: false,
    });
    const invalid = await handleCompleteMediaUpload(
      jsonRequest("/api/media/uploads/complete", { assetId, giftPublicId }),
      dependencies(),
    );
    expect(invalid.status).toBe(422);
  });

  it("lists and reads only validated gift-bound asset ids", async () => {
    const list = await handleListMediaAssets(
      new Request(`https://example.test/api/media/assets?giftPublicId=${giftPublicId}`),
      dependencies(),
    );
    expect(list.status).toBe(200);
    expect(listAssetsMock).toHaveBeenCalledWith(
      expect.objectContaining({ includeDownloadUrls: true }),
    );
    await handleListMediaAssets(
      new Request(
        `https://example.test/api/media/assets?giftPublicId=${giftPublicId}&includeDownloadUrls=false`,
      ),
      dependencies(),
    );
    expect(listAssetsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeDownloadUrls: false }),
    );
    const read = await handleGetMediaAsset(
      new Request(`https://example.test/api/media/assets/${assetId}?giftPublicId=${giftPublicId}`),
      assetId,
      dependencies(),
    );
    expect(read.status).toBe(200);
    const missing = await handleGetMediaAsset(
      new Request("https://example.test/api/media/assets/bad"),
      "bad",
      dependencies(),
    );
    expect(missing.status).toBe(404);
  });

  it("deletes and retries through same-origin JSON mutations", async () => {
    const removed = await handleDeleteMediaAsset(
      jsonRequest(`/api/media/assets/${assetId}`, { giftPublicId }, "DELETE"),
      assetId,
      dependencies(),
    );
    expect(removed.status).toBe(200);
    const retried = await handleRetryMediaAsset(
      jsonRequest(`/api/media/assets/${assetId}/retry`, { giftPublicId }),
      assetId,
      dependencies(),
    );
    expect(retried.status).toBe(200);
    expect(scheduleProcessing).toHaveBeenCalledExactlyOnceWith(assetId);
  });

  it("answers 404 to a delete refused for a published gift and 409 to a lost race", async () => {
    const deleteAsset = vi
      .fn<MediaService["deleteAsset"]>()
      .mockResolvedValueOnce({ error: { code: "NOT_FOUND" }, ok: false })
      .mockResolvedValueOnce({ error: { code: "INVALID_STATE" }, ok: false });
    service = { ...service, deleteAsset };
    const published = await handleDeleteMediaAsset(
      jsonRequest(`/api/media/assets/${assetId}`, { giftPublicId }, "DELETE"),
      assetId,
      dependencies(),
    );
    const lostRace = await handleDeleteMediaAsset(
      jsonRequest(`/api/media/assets/${assetId}`, { giftPublicId }, "DELETE"),
      assetId,
      dependencies(),
    );

    expect(published.status).toBe(404);
    expect(lostRace.status).toBe(409);
  });

  it("answers 404 to list, read and retry for assets of a published gift", async () => {
    const notFound = { error: { code: "NOT_FOUND" as const }, ok: false as const };
    listAssetsMock.mockResolvedValueOnce(notFound);
    service = {
      ...service,
      getAsset: vi.fn<MediaService["getAsset"]>(() => Promise.resolve(notFound)),
      retryAsset: vi.fn<MediaService["retryAsset"]>(() => Promise.resolve(notFound)),
    };

    const listed = await handleListMediaAssets(
      new Request(`https://example.test/api/media/assets?giftPublicId=${giftPublicId}`),
      dependencies(),
    );
    const read = await handleGetMediaAsset(
      new Request(`https://example.test/api/media/assets/${assetId}?giftPublicId=${giftPublicId}`),
      assetId,
      dependencies(),
    );
    const retried = await handleRetryMediaAsset(
      jsonRequest(`/api/media/assets/${assetId}/retry`, { giftPublicId }),
      assetId,
      dependencies(),
    );

    expect([listed.status, read.status, retried.status]).toEqual([404, 404, 404]);
    expect(scheduleProcessing).not.toHaveBeenCalled();
  });

  it("maps quota and unexpected failures to stable safe errors", async () => {
    initializeUploadMock.mockResolvedValue({
      error: { code: "QUOTA_EXCEEDED" },
      ok: false,
    });
    const quota = await handleInitializeMediaUpload(
      jsonRequest("/api/media/uploads/init", {
        contentType: "image/jpeg",
        fieldId: "photos",
        fileName: "memory.jpg",
        giftPublicId,
        sizeBytes: 3,
      }),
      dependencies(),
    );
    expect(quota.status).toBe(429);

    initializeUploadMock.mockResolvedValue({
      error: { code: "INVALID_FIELD" },
      ok: false,
    });
    const invalidField = await handleInitializeMediaUpload(
      jsonRequest("/api/media/uploads/init", {
        contentType: "image/jpeg",
        fieldId: "title",
        fileName: "memory.jpg",
        giftPublicId,
        sizeBytes: 3,
      }),
      dependencies(),
    );
    expect(invalidField.status).toBe(422);

    const missingQuery = await handleListMediaAssets(
      new Request("https://example.test/api/media/assets"),
      dependencies(),
    );
    expect(missingQuery.status).toBe(400);

    listAssetsMock.mockRejectedValue(new Error("database unavailable"));
    const unavailable = await handleListMediaAssets(
      new Request(`https://example.test/api/media/assets?giftPublicId=${giftPublicId}`),
      dependencies(),
    );
    expect(unavailable.status).toBe(500);
    expect(reportFailure).toHaveBeenCalledOnce();
  });
});
