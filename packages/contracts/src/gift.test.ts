import { describe, expect, it } from "vitest";

import {
  CreateGiftDraftRequestSchema,
  PublicGiftIdSchema,
  UpdateGiftDraftRequestSchema,
} from "./gift";

describe("gift API contracts", () => {
  it("accepts a versioned draft request", () => {
    expect(
      CreateGiftDraftRequestSchema.parse({
        anonymousDraftId: "8b56c9fc-e449-4dcb-a9ea-4fa620d17467",
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
});
