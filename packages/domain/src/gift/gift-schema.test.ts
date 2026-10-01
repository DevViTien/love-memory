import { describe, expect, it } from "vitest";

import { GiftSchema } from "./gift-schema";

describe("GiftSchema", () => {
  it("parses a valid published gift", () => {
    const result = GiftSchema.safeParse({
      access: { mode: "unlisted" },
      content: {
        data: { headline: "Mình cùng đi tiếp nhé" },
        schemaVersion: 1,
        templateId: "memory-box",
        templateVersion: "1.0.0",
      },
      createdAt: "2026-09-16T00:00:00.000Z",
      id: "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
      ownership: { anonymousDraftId: null, claimTokenHash: null, ownerId: "owner-1" },
      publicId: "q1w2e3r4t5y6u7i8",
      publishedAt: "2026-09-16T00:00:00.000Z",
      revision: 2,
      shareId: "Ab0_-cdefghijklmnopqrs",
      status: "published",
      updatedAt: "2026-09-16T00:00:00.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("requires a hash for password access", () => {
    const result = GiftSchema.safeParse({
      access: { mode: "password", passwordHash: "short" },
      content: {
        data: {},
        schemaVersion: 1,
        templateId: "memory-box",
        templateVersion: "1.0.0",
      },
      createdAt: new Date(),
      id: "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
      ownership: { anonymousDraftId: null, claimTokenHash: null, ownerId: "owner-1" },
      publicId: "q1w2e3r4t5y6u7i8",
      revision: 0,
      status: "draft",
      updatedAt: new Date(),
    });

    expect(result.success).toBe(false);
  });

  it("rejects anonymous ownership without both credentials", () => {
    const result = GiftSchema.safeParse({
      access: { mode: "unlisted" },
      content: {
        data: {},
        schemaVersion: 1,
        templateId: "memory-box",
        templateVersion: "1.0.0",
      },
      createdAt: new Date(),
      id: "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
      ownership: {
        anonymousDraftId: "2f7d675f-55d2-4e4b-b017-b0e0f9277ac2",
        claimTokenHash: null,
        ownerId: null,
      },
      publicId: "q1w2e3r4t5y6u7i8",
      revision: 0,
      status: "draft",
      updatedAt: new Date(),
    });

    expect(result.success).toBe(false);
  });

  it.each([
    {
      anonymousDraftId: "2f7d675f-55d2-4e4b-b017-b0e0f9277ac2",
      claimTokenHash: null,
      ownerId: "owner-1",
    },
    { anonymousDraftId: null, claimTokenHash: "a".repeat(64), ownerId: "owner-1" },
  ])("rejects owned gifts with residual anonymous credentials", (ownership) => {
    const result = GiftSchema.safeParse({
      access: { mode: "unlisted" },
      content: {
        data: {},
        schemaVersion: 1,
        templateId: "memory-box",
        templateVersion: "1.0.0",
      },
      createdAt: new Date(),
      id: "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
      ownership,
      publicId: "q1w2e3r4t5y6u7i8",
      revision: 0,
      status: "draft",
      updatedAt: new Date(),
    });

    expect(result.success).toBe(false);
  });

  describe("share fields", () => {
    const base = {
      access: { mode: "unlisted" },
      content: { data: {}, schemaVersion: 1, templateId: "memory-box", templateVersion: "1.1.0" },
      createdAt: new Date("2026-09-16T00:00:00.000Z"),
      id: "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
      ownership: { anonymousDraftId: null, claimTokenHash: null, ownerId: "owner-1" },
      publicId: "q1w2e3r4t5y6u7i8",
      revision: 3,
      updatedAt: new Date("2026-09-16T00:00:00.000Z"),
    } as const;
    const shareFields = {
      publishedAt: new Date("2026-09-16T00:00:00.000Z"),
      shareId: "Ab0_-cdefghijklmnopqrs",
    };

    it("rejects a published gift without a share id or publication time", () => {
      expect(GiftSchema.safeParse({ ...base, status: "published" }).success).toBe(false);
      expect(
        GiftSchema.safeParse({ ...base, shareId: shareFields.shareId, status: "published" })
          .success,
      ).toBe(false);
    });

    it("rejects a draft that carries a share id or publication time", () => {
      expect(GiftSchema.safeParse({ ...base, ...shareFields, status: "draft" }).success).toBe(
        false,
      );
      expect(
        GiftSchema.safeParse({ ...base, publishedAt: shareFields.publishedAt, status: "draft" })
          .success,
      ).toBe(false);
    });

    it("accepts a draft without share fields and a published gift with both", () => {
      expect(GiftSchema.safeParse({ ...base, status: "draft" }).success).toBe(true);
      expect(GiftSchema.safeParse({ ...base, ...shareFields, status: "published" }).success).toBe(
        true,
      );
    });

    it("rejects a malformed share id", () => {
      expect(
        GiftSchema.safeParse({ ...base, ...shareFields, shareId: "short", status: "published" })
          .success,
      ).toBe(false);
    });
  });
});
