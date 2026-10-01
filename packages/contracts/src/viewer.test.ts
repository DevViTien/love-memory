import { describe, expect, it } from "vitest";

import { PublicGiftResponseSchema, ViewerPayloadDtoSchema } from "./viewer";

const hash = "a".repeat(64);
const viewer = {
  artifactUrl: `/template-artifacts/memory-box/1.1.0/${hash}/index.html`,
  assets: { "550e8400-e29b-41d4-a716-446655440000": "https://blob.example/signed?token=1" },
  assetsExpireAt: "2026-10-01T08:05:00.000Z",
  audioUrl: "/audio-library/acoustic-morning.3f9a0c1d2e4b5a67.mp3",
  fields: [
    { id: "receiver-name", label: "Người nhận", required: true, type: "shortText" },
    {
      id: "memories",
      label: "Kỷ niệm",
      maxItems: 8,
      minItems: 3,
      required: true,
      type: "captionedImageList",
    },
  ],
  payload: { "receiver-name": "Minh Thư" },
} as const;

describe("viewer payload contract", () => {
  it("accepts a recipient payload and its response envelope", () => {
    expect(ViewerPayloadDtoSchema.parse(viewer)).toEqual(viewer);
    expect(PublicGiftResponseSchema.parse({ data: { viewer } })).toEqual({ data: { viewer } });
  });

  it("accepts the static-only form without an artifact, assets or audio", () => {
    expect(
      ViewerPayloadDtoSchema.safeParse({
        ...viewer,
        artifactUrl: null,
        assets: {},
        assetsExpireAt: null,
        audioUrl: null,
      }).success,
    ).toBe(true);
  });

  it("rejects creator issues and unknown keys", () => {
    expect(ViewerPayloadDtoSchema.safeParse({ ...viewer, issues: [] }).success).toBe(false);
    expect(ViewerPayloadDtoSchema.safeParse({ ...viewer, giftId: "x" }).success).toBe(false);
  });

  it("rejects an absolute artifact URL and a foreign audio URL", () => {
    expect(
      ViewerPayloadDtoSchema.safeParse({
        ...viewer,
        artifactUrl: `https://evil.example/template-artifacts/memory-box/1.1.0/${hash}/index.html`,
      }).success,
    ).toBe(false);
    expect(
      ViewerPayloadDtoSchema.safeParse({ ...viewer, audioUrl: "https://evil.example/a.mp3" })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown field type", () => {
    expect(
      ViewerPayloadDtoSchema.safeParse({
        ...viewer,
        fields: [{ id: "x", label: "X", required: false, type: "video" }],
      }).success,
    ).toBe(false);
  });
});
