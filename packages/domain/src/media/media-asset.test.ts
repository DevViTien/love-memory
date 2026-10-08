import { describe, expect, it } from "vitest";

import { canTransitionMediaAsset, MediaAssetSchema } from "./media-asset";

const base = {
  anonymousDraftId: null,
  attempts: 0,
  checksumSha256: null,
  createdAt: new Date("2026-09-17T00:00:00.000Z"),
  declaredContentType: "image/jpeg" as const,
  declaredSizeBytes: 12,
  derivatives: [],
  expiresAt: new Date("2026-09-17T00:10:00.000Z"),
  failureCode: null,
  fieldId: "photos",
  fieldSlot: 0,
  giftId: "3d594650-3436-4ca1-8a1a-5fc8a10bd154",
  giftSlot: 0,
  id: "550e8400-e29b-41d4-a716-446655440000",
  ownerId: "user-1",
  placeholderDataUrl: null,
  sourceKey: "private/assets/id/source",
  status: "initiated" as const,
  updatedAt: new Date("2026-09-17T00:00:00.000Z"),
};

describe("media asset", () => {
  it("requires exactly one owner identity", () => {
    expect(MediaAssetSchema.safeParse(base).success).toBe(true);
    expect(
      MediaAssetSchema.safeParse({
        ...base,
        anonymousDraftId: "65d24011-ab21-47b7-afbd-9cc1a5b303f9",
      }).success,
    ).toBe(false);
  });

  it("requires derivatives before an asset becomes ready", () => {
    expect(MediaAssetSchema.safeParse({ ...base, status: "ready" }).success).toBe(false);
  });

  describe("detached assets", () => {
    const ready = {
      ...base,
      derivatives: [
        { contentType: "image/webp" as const, height: 800, key: "private/d/800", width: 640 },
      ],
      status: "ready" as const,
    };
    const detachedAt = new Date("2026-10-01T00:00:00.000Z");

    it("defaults legacy documents to not detached", () => {
      expect(MediaAssetSchema.parse(base).detachedAt).toBeNull();
    });

    it("accepts a detached ready asset without slots", () => {
      expect(
        MediaAssetSchema.safeParse({ ...ready, detachedAt, fieldSlot: null, giftSlot: null })
          .success,
      ).toBe(true);
    });

    it("rejects a detached asset that keeps slots or is not ready", () => {
      expect(MediaAssetSchema.safeParse({ ...ready, detachedAt }).success).toBe(false);
      expect(
        MediaAssetSchema.safeParse({
          ...ready,
          detachedAt,
          fieldSlot: null,
          giftSlot: null,
          status: "deleting",
        }).success,
      ).toBe(false);
    });
  });

  it("only permits explicit lifecycle transitions", () => {
    expect(canTransitionMediaAsset("initiated", "uploaded")).toBe(true);
    expect(canTransitionMediaAsset("failed", "processing")).toBe(true);
    expect(canTransitionMediaAsset("ready", "processing")).toBe(false);
    expect(canTransitionMediaAsset("deleted", "ready")).toBe(false);
  });
});
