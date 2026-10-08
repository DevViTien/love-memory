import { describe, expect, it } from "vitest";

import {
  CreateGiftDraftRequestSchema,
  CreateGiftPreviewRequestSchema,
  GiftDraftDtoSchema,
  GiftPreviewLinkDtoSchema,
  GiftPreviewLinkResponseSchema,
  GiftPublicationDtoSchema,
  GiftPublicationResponseSchema,
  PublicGiftIdSchema,
  PublishGiftRequestSchema,
  ShareIdSchema,
  UpdateGiftDraftRequestSchema,
} from "./gift";

describe("gift API contracts", () => {
  it("accepts a versioned draft request", () => {
    expect(
      CreateGiftDraftRequestSchema.parse({
        templateId: "memory-box",
        templateVersion: "1.0.0",
      }),
    ).toMatchObject({ templateId: "memory-box", templateVersion: "1.0.0" });
  });

  it("rejects unknown request properties and invalid revisions", () => {
    expect(
      UpdateGiftDraftRequestSchema.safeParse({ content: {}, expectedRevision: -1, ownerId: "x" })
        .success,
    ).toBe(false);
  });

  it("reuses the domain public id invariant", () => {
    expect(PublicGiftIdSchema.safeParse("invalid id with spaces").success).toBe(false);
  });

  it("accepts only an empty preview request body", () => {
    expect(CreateGiftPreviewRequestSchema.safeParse({}).success).toBe(true);
    expect(CreateGiftPreviewRequestSchema.safeParse({ ttl: 99999 }).success).toBe(false);
  });

  it("accepts a same-origin preview link with an expiry", () => {
    const link = { expiresAt: "2026-10-01T10:30:00.000Z", url: `/preview/${"a".repeat(43)}` };

    expect(GiftPreviewLinkDtoSchema.parse(link)).toEqual(link);
    expect(GiftPreviewLinkResponseSchema.parse({ data: link })).toEqual({ data: link });
  });

  it("rejects extra keys, short tokens, absolute URLs and invalid expiries", () => {
    const expiresAt = "2026-10-01T10:30:00.000Z";
    const token = "A-_b".repeat(10) + "xyz";

    expect(
      GiftPreviewLinkDtoSchema.safeParse({ expiresAt, token, url: `/preview/${token}` }).success,
    ).toBe(false);
    expect(
      GiftPreviewLinkDtoSchema.safeParse({ expiresAt, url: `/preview/${token.slice(1)}` }).success,
    ).toBe(false);
    expect(
      GiftPreviewLinkDtoSchema.safeParse({
        expiresAt,
        url: `https://love.example/preview/${token}`,
      }).success,
    ).toBe(false);
    expect(
      GiftPreviewLinkDtoSchema.safeParse({ expiresAt: "tomorrow", url: `/preview/${token}` })
        .success,
    ).toBe(false);
    expect(
      GiftPreviewLinkResponseSchema.safeParse({
        data: { expiresAt, url: `/preview/${token}` },
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("exposes a JSON-safe draft DTO without persistence fields", () => {
    expect(
      GiftDraftDtoSchema.parse({
        content: {},
        createdAt: "2026-09-16T00:00:00.000Z",
        ownerKind: "anonymous",
        publicId: "q1w2e3r4t5y6u7i8",
        publication: null,
        revision: 0,
        status: "draft",
        templateId: "memory-box",
        templateVersion: "1.0.0",
        updatedAt: "2026-09-16T00:00:00.000Z",
      }),
    ).not.toHaveProperty("_id");
  });

  describe("published gift summary", () => {
    const shareId = "Ab0_-cdefghijklmnopqrs";
    const working = {
      content: {},
      createdAt: "2026-09-16T00:00:00.000Z",
      ownerKind: "user",
      publicId: "q1w2e3r4t5y6u7i8",
      revision: 9,
      status: "published",
      templateId: "memory-box",
      templateVersion: "1.1.0",
      updatedAt: "2026-10-02T00:00:00.000Z",
    } as const;
    const summary = {
      publishedAt: "2026-10-01T08:00:00.000Z",
      revision: 7,
      shareId,
      sharePath: `/g/${shareId}`,
    };

    it("accepts a published gift's working copy with its publication summary", () => {
      expect(GiftDraftDtoSchema.parse({ ...working, publication: summary }).publication).toEqual(
        summary,
      );
    });

    it("rejects a summary with extra keys or another share path, and a DTO without one", () => {
      expect(
        GiftDraftDtoSchema.safeParse({ ...working, publication: { ...summary, content: {} } })
          .success,
      ).toBe(false);
      expect(
        GiftDraftDtoSchema.safeParse({
          ...working,
          publication: { ...summary, sharePath: `/s/${shareId}` },
        }).success,
      ).toBe(false);
      expect(GiftDraftDtoSchema.safeParse(working).success).toBe(false);
    });
  });

  describe("publish", () => {
    const shareId = "Ab0_-cdefghijklmnopqrs";
    const publication = {
      publicId: "q1w2e3r4t5y6u7i8",
      publishedAt: "2026-10-01T08:00:00.000Z",
      revision: 7,
      shareId,
      sharePath: `/g/${shareId}`,
      status: "published",
    } as const;

    it("accepts only a non-negative expected revision in the request", () => {
      expect(PublishGiftRequestSchema.parse({ expectedRevision: 3 })).toEqual({
        expectedRevision: 3,
      });
      expect(PublishGiftRequestSchema.safeParse({ expectedRevision: -1 }).success).toBe(false);
      expect(
        PublishGiftRequestSchema.safeParse({ expectedRevision: 3, shareId: "abc" }).success,
      ).toBe(false);
      expect(PublishGiftRequestSchema.safeParse({}).success).toBe(false);
    });

    it("accepts a publication DTO and its response envelope", () => {
      expect(GiftPublicationDtoSchema.parse(publication)).toEqual(publication);
      expect(GiftPublicationResponseSchema.parse({ data: { publication } })).toEqual({
        data: { publication },
      });
    });

    it("rejects extra keys and a share path with another prefix", () => {
      expect(GiftPublicationDtoSchema.safeParse({ ...publication, giftId: "x" }).success).toBe(
        false,
      );
      expect(
        GiftPublicationDtoSchema.safeParse({ ...publication, sharePath: `/share/${shareId}` })
          .success,
      ).toBe(false);
      expect(
        GiftPublicationDtoSchema.safeParse({
          ...publication,
          sharePath: `https://love.example/g/${shareId}`,
        }).success,
      ).toBe(false);
    });

    it("re-exports the domain share id rule", () => {
      expect(ShareIdSchema.safeParse(shareId).success).toBe(true);
      expect(ShareIdSchema.safeParse(shareId.slice(1)).success).toBe(false);
    });
  });
});
