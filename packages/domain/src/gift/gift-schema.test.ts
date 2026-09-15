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
      ownerId: "owner-1",
      publicId: "q1w2e3r4t5y6u7i8",
      revision: 2,
      status: "published",
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
      ownerId: "owner-1",
      publicId: "q1w2e3r4t5y6u7i8",
      revision: 0,
      status: "draft",
    });

    expect(result.success).toBe(false);
  });
});
