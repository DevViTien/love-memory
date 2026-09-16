import { describe, expect, it, vi } from "vitest";

import {
  type MediaSpikeService,
  UploadVerificationError,
} from "../application/media-spike-service";
import {
  handleCleanupUpload,
  handleCompleteUpload,
  handleInitializeUpload,
} from "./upload-route-handlers";

const token = "a-development-token-with-32-characters";
const environment = { enabled: true, token } as const;
const assetId = "550e8400-e29b-41d4-a716-446655440000";

function createRequest(body: unknown, bearerToken = token): Request {
  return new Request("https://example.test/api/spikes/uploads", {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${bearerToken}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
}

function createService(): MediaSpikeService {
  return {
    cleanupUpload: vi.fn(() => Promise.resolve({ assetId, deleted: true as const })),
    completeUpload: vi.fn(() =>
      Promise.resolve({
        assetId,
        contentType: "image/webp" as const,
        downloadUrl: "https://store.private.blob.vercel-storage.com/processed?signed=true",
        height: 768,
        width: 512,
      }),
    ),
    initializeUpload: vi.fn(() =>
      Promise.resolve({
        assetId,
        expiresAt: "2026-09-15T00:05:00.000Z",
        headers: { "content-type": "image/jpeg" },
        method: "PUT" as const,
        uploadUrl: "https://blob.vercel-storage.com/source?signed=true",
      }),
    ),
  };
}

describe("upload spike route handlers", () => {
  it("hides disabled endpoints and protects enabled endpoints", async () => {
    const service = createService();
    const disabled = await handleInitializeUpload(createRequest({}), {
      environment: { enabled: false, token: undefined },
      getService: () => service,
    });
    const unauthorized = await handleInitializeUpload(createRequest({}, "wrong"), {
      environment,
      getService: () => service,
    });

    expect(disabled.status).toBe(404);
    expect(unauthorized.status).toBe(401);
  });

  it("validates and initializes a direct upload", async () => {
    const service = createService();
    const response = await handleInitializeUpload(
      createRequest({ contentType: "image/jpeg", fileName: "memory.jpg", sizeBytes: 1024 }),
      { environment, getService: () => service },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ data: { assetId } });
  });

  it("rejects invalid complete bodies without invoking storage", async () => {
    const service = createService();
    const response = await handleCompleteUpload(createRequest({ assetId: "bad" }), {
      environment,
      getService: () => service,
    });

    expect(response.status).toBe(400);
    expect(service.completeUpload).not.toHaveBeenCalled();
  });

  it("cleans up a valid spike asset", async () => {
    const service = createService();
    const response = await handleCleanupUpload(createRequest({ assetId }), {
      environment,
      getService: () => service,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { assetId, deleted: true } });
    expect(service.cleanupUpload).toHaveBeenCalledWith({ assetId });
  });

  it("reports cleanup failures without exposing provider details", async () => {
    const reportFailure = vi.fn();
    const service = createService();
    vi.mocked(service.cleanupUpload).mockRejectedValue(new Error("private provider failure"));

    const response = await handleCleanupUpload(createRequest({ assetId }), {
      environment,
      getService: () => service,
      reportFailure,
    });

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private provider failure");
    expect(reportFailure).toHaveBeenCalledWith(
      "media.cleanup-upload",
      expect.any(Error),
      expect.any(String),
    );
  });

  it("returns a safe validation response for rejected media", async () => {
    const reportFailure = vi.fn();
    const service = createService();
    vi.mocked(service.completeUpload).mockRejectedValue(new UploadVerificationError("private"));
    const response = await handleCompleteUpload(createRequest({ assetId }), {
      environment,
      getService: () => service,
      reportFailure,
    });

    expect(response.status).toBe(422);
    expect(reportFailure).toHaveBeenCalledWith(
      "media.complete-upload",
      expect.any(UploadVerificationError),
      expect.any(String),
    );
  });
});
