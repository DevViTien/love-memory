import { type Gift, type MediaAsset } from "@love-memory/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGiftExportService } from "./gift-export";
import { type GiftAccessor } from "./gift-service";

const now = new Date("2026-10-10T10:00:00.000Z");
const owner: GiftAccessor = { kind: "user", userId: "user-1" };
const anonymous: GiftAccessor = {
  anonymousDraftId: "11111111-1111-4111-8111-111111111111",
  claimTokenHash: "a".repeat(64),
  kind: "anonymous",
};

function gift(overrides: Partial<Gift> = {}): Gift {
  return {
    access: { mode: "unlisted" },
    content: {
      data: { receiver: "Minh Thư" },
      schemaVersion: 1,
      templateId: "memory-box",
      templateVersion: "1.1.0",
    },
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    entitlement: { planId: "free" },
    expiresAt: new Date("2026-10-15T00:00:00.000Z"),
    id: "gift-1",
    ownership: { anonymousDraftId: null, claimTokenHash: null, ownerId: "user-1" },
    publicId: "pub-1",
    publishedAt: new Date("2026-10-01T00:00:00.000Z"),
    publishedRevision: 2,
    revision: 3,
    shareId: "Ab0_-cdefghijklmnopqrs",
    status: "published",
    updatedAt: new Date("2026-10-02T00:00:00.000Z"),
    ...overrides,
  } as Gift;
}

function asset(id: string, status: MediaAsset["status"]): MediaAsset {
  return {
    derivatives: [
      { contentType: "image/webp", height: 240, key: `private/${id}/w320.webp`, width: 320 },
      { contentType: "image/webp", height: 960, key: `private/${id}/w1280.webp`, width: 1280 },
    ],
    fieldId: "memories",
    id,
    sourceKey: `private/${id}/source`,
    status,
  } as unknown as MediaAsset;
}

describe("gift export", () => {
  const findAuthorized =
    vi.fn<(publicId: string, accessors: readonly GiftAccessor[]) => Promise<Gift | null>>();
  const listByGiftId = vi.fn<(giftId: string) => Promise<readonly MediaAsset[]>>();
  const signDownloadUrl = vi.fn((key: string, ttl: number) =>
    Promise.resolve(`https://blob.example/${key}?ttl=${ttl}`),
  );
  const service = createGiftExportService({
    assets: { listByGiftId },
    clock: () => now,
    gifts: { findAuthorized },
    signDownloadUrl,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    listByGiftId.mockResolvedValue([asset("a1", "ready"), asset("a2", "processing")]);
  });

  it("exports exactly the documented fields with signed largest photos (Owner exports a published gift)", async () => {
    findAuthorized.mockResolvedValueOnce(gift());

    const exported = await service.export("pub-1", [owner]);

    expect(Object.keys(exported ?? {}).sort()).toEqual([
      "content",
      "exportedAt",
      "gift",
      "photos",
      "photosNote",
      "publication",
    ]);
    expect(exported).toMatchObject({
      content: { receiver: "Minh Thư" },
      exportedAt: now.toISOString(),
      gift: { publicId: "pub-1", revision: 3, status: "published", templateId: "memory-box" },
      photos: [
        {
          assetId: "a1",
          fieldId: "memories",
          height: 960,
          url: "https://blob.example/private/a1/w1280.webp?ttl=300",
          width: 1280,
        },
      ],
      publication: {
        expiresAt: "2026-10-15T00:00:00.000Z",
        planId: "free",
        revision: 2,
        sharePath: "/g/Ab0_-cdefghijklmnopqrs",
      },
    });
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain("private/a1/source");
    expect(serialized).not.toContain("ownership");
  });

  it("exports a draft to its anonymous browser, with no publication", async () => {
    findAuthorized.mockResolvedValueOnce(
      gift({
        ownership: { anonymousDraftId: "x", claimTokenHash: "a".repeat(64), ownerId: null },
        publishedAt: undefined,
        publishedRevision: undefined,
        shareId: undefined,
        status: "draft",
      }),
    );

    await expect(service.export("pub-1", [anonymous])).resolves.toMatchObject({
      gift: { status: "draft" },
      publication: null,
    });
  });

  it("refuses others, a published gift through a draft cookie, and a deleting gift (Someone else asks for the export)", async () => {
    await expect(service.export("pub-1", [])).resolves.toBeNull();
    findAuthorized.mockResolvedValueOnce(null);
    await expect(service.export("pub-1", [owner])).resolves.toBeNull();
    findAuthorized.mockResolvedValueOnce(gift());
    await expect(service.export("pub-1", [anonymous])).resolves.toBeNull();
    findAuthorized.mockResolvedValueOnce(gift({ status: "deleting" }));
    await expect(service.export("pub-1", [owner])).resolves.toBeNull();
    expect(listByGiftId).not.toHaveBeenCalled();
  });
});
