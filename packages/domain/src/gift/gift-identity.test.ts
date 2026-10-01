import { describe, expect, it } from "vitest";

import {
  GiftTemplateIdSchema,
  GiftTemplateVersionSchema,
  PublicGiftIdSchema,
  ShareIdSchema,
} from "./gift-identity";

describe("gift identity schemas", () => {
  it("accepts a URL-safe public gift id", () => {
    expect(PublicGiftIdSchema.parse("q1w2e3r4t5y6u7i8")).toBe("q1w2e3r4t5y6u7i8");
  });

  it.each(["too-short", "invalid public id!!!"])("rejects public id %s", (publicId) => {
    expect(PublicGiftIdSchema.safeParse(publicId).success).toBe(false);
  });

  it("validates template references consistently", () => {
    expect(GiftTemplateIdSchema.parse("memory-box")).toBe("memory-box");
    expect(GiftTemplateVersionSchema.parse("1.2.0-beta.1")).toBe("1.2.0-beta.1");
  });

  it("accepts a share id of exactly 22 base64url characters", () => {
    expect(ShareIdSchema.parse("Ab0_-cdefghijklmnopqrs")).toBe("Ab0_-cdefghijklmnopqrs");
  });

  it.each(["a".repeat(21), "a".repeat(23), "+".repeat(22), "a".repeat(21) + "="])(
    "rejects share id %s",
    (shareId) => {
      expect(ShareIdSchema.safeParse(shareId).success).toBe(false);
    },
  );
});
