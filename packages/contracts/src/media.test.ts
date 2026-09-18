import { describe, expect, it } from "vitest";

import {
  MediaAssetDtoSchema,
  MediaUploadCompleteRequestSchema,
  MediaUploadInitRequestSchema,
} from "./media";

describe("media contracts", () => {
  it("accepts bounded image declarations and rejects executable formats", () => {
    const base = {
      fieldId: "photos",
      fileName: "memory.jpg",
      giftPublicId: "abcdefghijklmnop",
      sizeBytes: 1024,
    };
    expect(
      MediaUploadInitRequestSchema.safeParse({ ...base, contentType: "image/jpeg" }).success,
    ).toBe(true);
    expect(
      MediaUploadInitRequestSchema.safeParse({ ...base, contentType: "image/svg+xml" }).success,
    ).toBe(false);
  });

  it("requires opaque UUID asset identities", () => {
    expect(
      MediaUploadCompleteRequestSchema.safeParse({
        assetId: "guessable",
        giftPublicId: "abcdefghijklmnop",
      }).success,
    ).toBe(false);
  });

  it("never exposes storage keys in the browser DTO", () => {
    const parsed = MediaAssetDtoSchema.parse({
      assetId: "550e8400-e29b-41d4-a716-446655440000",
      derivatives: [],
      failureCode: null,
      fieldId: "photos",
      placeholderDataUrl: null,
      status: "processing",
    });
    expect(parsed).not.toHaveProperty("sourceKey");
  });
});
