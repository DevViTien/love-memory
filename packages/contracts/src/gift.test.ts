import { describe, expect, it } from "vitest";

import {
  CreateGiftDraftRequestSchema,
  GiftDraftDtoSchema,
  PublicGiftIdSchema,
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

  it("exposes a JSON-safe draft DTO without persistence fields", () => {
    expect(
      GiftDraftDtoSchema.parse({
        content: {},
        createdAt: "2026-09-16T00:00:00.000Z",
        ownerKind: "anonymous",
        publicId: "q1w2e3r4t5y6u7i8",
        revision: 0,
        status: "draft",
        templateId: "memory-box",
        templateVersion: "1.0.0",
        updatedAt: "2026-09-16T00:00:00.000Z",
      }),
    ).not.toHaveProperty("_id");
  });
});
