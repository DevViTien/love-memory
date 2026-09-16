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
      revision: 2,
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
});
