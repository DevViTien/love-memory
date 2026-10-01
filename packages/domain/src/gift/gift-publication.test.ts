import { describe, expect, it } from "vitest";

import { createGiftPublication, publishGiftDraft } from "./gift-publication";
import { GiftSchema, type Gift } from "./gift-schema";

const created = new Date("2026-09-16T00:00:00.000Z");
const now = new Date("2026-10-01T08:00:00.000Z");
const shareId = "Ab0_-cdefghijklmnopqrs";
const hash = "a".repeat(64);
const publicationId = "0f8fad5b-d9cb-469f-a165-70867728950e";

function draft(overrides: Partial<Gift> = {}): Gift {
  return GiftSchema.parse({
    access: { mode: "unlisted" },
    content: {
      data: { "receiver-name": "Minh Thư" },
      schemaVersion: 1,
      templateId: "memory-box",
      templateVersion: "1.1.0",
    },
    createdAt: created,
    id: "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
    ownership: { anonymousDraftId: null, claimTokenHash: null, ownerId: "owner-1" },
    publicId: "q1w2e3r4t5y6u7i8",
    revision: 7,
    status: "draft",
    updatedAt: created,
    ...overrides,
  });
}

function published(): Gift {
  const result = publishGiftDraft(draft(), { expectedRevision: 7, now, shareId });
  if (!result.ok) throw new Error("Expected a published gift.");
  return result.data;
}

describe("publishGiftDraft", () => {
  it("publishes an owned draft at its revision through publishing", () => {
    const gift = published();

    expect(gift).toMatchObject({
      publishedAt: now,
      revision: 7,
      shareId,
      status: "published",
      updatedAt: now,
    });
    expect(gift.content).toEqual(draft().content);
  });

  it("refuses a gift that is not a draft", () => {
    expect(publishGiftDraft(published(), { expectedRevision: 7, now, shareId })).toEqual({
      error: { code: "GIFT_NOT_DRAFT" },
      ok: false,
    });
  });

  it("refuses a stale revision", () => {
    expect(publishGiftDraft(draft(), { expectedRevision: 6, now, shareId })).toEqual({
      error: { actualRevision: 7, code: "GIFT_REVISION_CONFLICT", expectedRevision: 6 },
      ok: false,
    });
  });

  it("refuses an unclaimed anonymous draft", () => {
    const anonymous = draft({
      ownership: {
        anonymousDraftId: "2f7d675f-55d2-4e4b-b017-b0e0f9277ac2",
        claimTokenHash: "b".repeat(64),
        ownerId: null,
      },
    });

    expect(publishGiftDraft(anonymous, { expectedRevision: 7, now, shareId })).toEqual({
      error: { code: "GIFT_NOT_OWNED" },
      ok: false,
    });
  });
});

describe("createGiftPublication", () => {
  it("copies the snapshot fields from the published gift", () => {
    const publication = createGiftPublication({
      artifactContentHash: hash,
      assetIds: ["550e8400-e29b-41d4-a716-446655440000"],
      audioTrackId: null,
      gift: published(),
      id: publicationId,
    });

    expect(publication).toEqual({
      artifactContentHash: hash,
      assetIds: ["550e8400-e29b-41d4-a716-446655440000"],
      audioTrackId: null,
      content: { "receiver-name": "Minh Thư" },
      createdAt: now,
      giftId: "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
      id: publicationId,
      publishedAt: now,
      revision: 7,
      shareId,
      templateId: "memory-box",
      templateVersion: "1.1.0",
    });
  });

  it("refuses to snapshot a gift that is not published", () => {
    expect(() =>
      createGiftPublication({
        artifactContentHash: hash,
        assetIds: [],
        audioTrackId: null,
        gift: draft(),
        id: publicationId,
      }),
    ).toThrow("Only a published gift can be snapshotted.");
  });

  it("rejects duplicate asset ids and a malformed artifact hash", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";

    expect(() =>
      createGiftPublication({
        artifactContentHash: hash,
        assetIds: [id, id],
        audioTrackId: null,
        gift: published(),
        id: publicationId,
      }),
    ).toThrow();
    expect(() =>
      createGiftPublication({
        artifactContentHash: "XYZ",
        assetIds: [],
        audioTrackId: null,
        gift: published(),
        id: publicationId,
      }),
    ).toThrow();
  });
});
