import { describe, expect, it } from "vitest";

import { claimGiftDraft, createGiftDraft, updateGiftDraft } from "./gift-draft";
import { GiftSchema } from "./gift-schema";

const now = new Date("2026-09-16T00:00:00.000Z");

function createAnonymousDraft() {
  return createGiftDraft({
    anonymousDraftId: "2f7d675f-55d2-4e4b-b017-b0e0f9277ac2",
    claimTokenHash: "a".repeat(64),
    content: {
      data: {},
      schemaVersion: 1,
      templateId: "memory-box",
      templateVersion: "1.0.0",
    },
    id: "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
    now,
    ownerId: null,
    publicId: "q1w2e3r4t5y6u7i8",
  });
}

describe("gift draft behavior", () => {
  it("claims an anonymous draft without retaining claim credentials", () => {
    const claimed = claimGiftDraft(createAnonymousDraft(), {
      now: new Date("2026-09-16T01:00:00.000Z"),
      ownerId: "user-1",
    });

    expect(claimed.ok).toBe(true);
    if (claimed.ok) {
      expect(claimed.data.ownership).toEqual({
        anonymousDraftId: null,
        claimTokenHash: null,
        ownerId: "user-1",
      });
    }
  });

  it("increments an expected revision", () => {
    const draft = createAnonymousDraft();
    const updated = updateGiftDraft(draft, {
      content: { ...draft.content, data: { headline: "Our story" } },
      expectedRevision: 0,
      now: new Date("2026-09-16T01:00:00.000Z"),
    });

    expect(updated.ok && updated.data.revision).toBe(1);
  });

  it("saves the working copy of a published gift and keeps its publication", () => {
    const owned = createGiftDraft({
      anonymousDraftId: null,
      claimTokenHash: null,
      content: createAnonymousDraft().content,
      id: "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
      now,
      ownerId: "user-1",
      publicId: "q1w2e3r4t5y6u7i8",
    });
    const published = GiftSchema.parse({
      ...owned,
      publishedAt: now,
      publishedRevision: 0,
      shareId: "Ab0_-cdefghijklmnopqrs",
      status: "published",
    });

    const updated = updateGiftDraft(published, {
      content: { ...published.content, data: { headline: "Sửa sau khi gửi" } },
      expectedRevision: 0,
      now: new Date("2026-09-16T01:00:00.000Z"),
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data).toMatchObject({ publishedRevision: 0, revision: 1, status: "published" });
    expect(claimGiftDraft(published, { now, ownerId: "user-2" })).toEqual({
      error: { code: "GIFT_NOT_DRAFT" },
      ok: false,
    });
  });

  it("refuses to save a gift whose status is not editable", () => {
    const paused = GiftSchema.parse({ ...createAnonymousDraft(), status: "paused" });

    expect(updateGiftDraft(paused, { content: paused.content, expectedRevision: 0, now })).toEqual({
      error: { code: "GIFT_NOT_DRAFT" },
      ok: false,
    });
  });

  it("returns a structured conflict instead of overwriting newer content", () => {
    const conflict = updateGiftDraft(createAnonymousDraft(), {
      content: {
        data: { headline: "Stale content" },
        schemaVersion: 1,
        templateId: "memory-box",
        templateVersion: "1.0.0",
      },
      expectedRevision: 4,
      now,
    });

    expect(conflict).toEqual({
      error: { actualRevision: 0, code: "GIFT_REVISION_CONFLICT", expectedRevision: 4 },
      ok: false,
    });
  });
});
