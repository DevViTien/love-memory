import { describe, expect, it } from "vitest";

import {
  UPLOAD_LIMITS,
  UploadCompleteResponseSchema,
  UploadInitRequestSchema,
  UploadInitResponseSchema,
} from "./upload";

describe("upload contracts", () => {
  it("accepts a bounded image upload request", () => {
    expect(
      UploadInitRequestSchema.parse({
        contentType: "image/jpeg",
        fileName: "ky-niem.jpg",
        sizeBytes: 1024,
      }),
    ).toMatchObject({ contentType: "image/jpeg", sizeBytes: 1024 });
  });

  it("rejects unsupported media, unsafe names and oversized files", () => {
    expect(
      UploadInitRequestSchema.safeParse({
        contentType: "image/svg+xml",
        fileName: "../memory.svg",
        sizeBytes: UPLOAD_LIMITS.imageMaxBytes + 1,
      }).success,
    ).toBe(false);
  });

  it("validates init and processed response envelopes", () => {
    const assetId = "550e8400-e29b-41d4-a716-446655440000";

    expect(
      UploadInitResponseSchema.parse({
        data: {
          assetId,
          expiresAt: "2026-09-15T00:05:00.000Z",
          headers: { "content-type": "image/png" },
          method: "PUT",
          uploadUrl: "https://blob.vercel-storage.com/source?signature=test",
        },
      }).data.assetId,
    ).toBe(assetId);

    expect(
      UploadCompleteResponseSchema.parse({
        data: {
          assetId,
          contentType: "image/webp",
          downloadUrl: "https://store.private.blob.vercel-storage.com/processed?signature=test",
          height: 768,
          width: 512,
        },
      }).data.contentType,
    ).toBe("image/webp");
  });
});
