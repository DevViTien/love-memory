import { describe, expect, it } from "vitest";

import { grantEntitlement } from "../billing/gift-entitlement";
import { currentPlan } from "../billing/plan";
import { updateGiftDraft } from "./gift-draft";
import { createGiftPublication, publishGiftDraft, republishGift } from "./gift-publication";
import { GiftSchema, type Gift } from "./gift-schema";

const created = new Date("2026-09-16T00:00:00.000Z");
const now = new Date("2026-10-01T08:00:00.000Z");
const shareId = "Ab0_-cdefghijklmnopqrs";
const hash = "a".repeat(64);
const publicationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
const grant = grantEntitlement(currentPlan("free"), "free", now);

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
  const result = publishGiftDraft(draft(), { expectedRevision: 7, grant, now, shareId });
  if (!result.ok) throw new Error("Expected a published gift.");
  return result.data;
}

describe("publishGiftDraft", () => {
  it("publishes an owned draft at its revision through publishing", () => {
    const gift = published();

    expect(gift).toMatchObject({
      publishedAt: now,
      publishedRevision: 7,
      revision: 7,
      shareId,
      status: "published",
      updatedAt: now,
    });
    expect(gift.content).toEqual(draft().content);
  });

  it("grants the entitlement and its expiry at the first publish", () => {
    const gift = published();

    expect(gift.entitlement).toEqual(grant.entitlement);
    expect(gift.expiresAt).toEqual(new Date("2026-10-15T08:00:00.000Z"));
  });

  it("refuses a gift that is not a draft", () => {
    expect(publishGiftDraft(published(), { expectedRevision: 7, grant, now, shareId })).toEqual({
      error: { code: "GIFT_NOT_DRAFT" },
      ok: false,
    });
  });

  it("refuses a stale revision", () => {
    expect(publishGiftDraft(draft(), { expectedRevision: 6, grant, now, shareId })).toEqual({
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

    expect(publishGiftDraft(anonymous, { expectedRevision: 7, grant, now, shareId })).toEqual({
      error: { code: "GIFT_NOT_OWNED" },
      ok: false,
    });
  });
});

const later = new Date("2026-10-02T09:00:00.000Z");

/** A gift published at revision 7 whose working copy was saved twice, to revision 9. */
function edited(): Gift {
  let gift = published();
  for (const revision of [7, 8]) {
    const saved = updateGiftDraft(gift, {
      content: { ...gift.content, data: { "receiver-name": `Minh Thư ${revision}` } },
      expectedRevision: revision,
      now,
    });
    if (!saved.ok) throw new Error("Expected the working copy to save.");
    gift = saved.data;
  }
  return gift;
}

describe("republishGift", () => {
  it("publishes a newer revision under the same share id", () => {
    const result = republishGift(edited(), { expectedRevision: 9, now: later });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      publishedAt: later,
      publishedRevision: 9,
      revision: 9,
      shareId,
      status: "published",
      updatedAt: later,
    });
    expect(result.data.entitlement).toEqual(grant.entitlement);
    expect(result.data.expiresAt).toEqual(grant.expiresAt);
  });

  it("refuses a draft", () => {
    expect(republishGift(draft(), { expectedRevision: 7, now: later })).toEqual({
      error: { code: "GIFT_NOT_PUBLISHED" },
      ok: false,
    });
  });

  it("refuses a stale revision", () => {
    expect(republishGift(edited(), { expectedRevision: 8, now: later })).toEqual({
      error: { actualRevision: 9, code: "GIFT_REVISION_CONFLICT", expectedRevision: 8 },
      ok: false,
    });
  });

  it("refuses a revision that is already the current publication", () => {
    expect(republishGift(published(), { expectedRevision: 7, now: later })).toEqual({
      error: { code: "GIFT_NO_UNPUBLISHED_CHANGES" },
      ok: false,
    });
  });

  it("snapshots the new revision with the gift's share id", () => {
    const result = republishGift(edited(), { expectedRevision: 9, now: later });
    if (!result.ok) throw new Error("Expected a republished gift.");

    const publication = createGiftPublication({
      artifactContentHash: hash,
      assetIds: [],
      audioTrackId: null,
      gift: result.data,
      id: publicationId,
    });

    expect(publication).toMatchObject({
      content: { "receiver-name": "Minh Thư 8" },
      publishedAt: later,
      revision: 9,
      shareId,
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
