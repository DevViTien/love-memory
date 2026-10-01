import { describe, expect, it, vi } from "vitest";

import { type AnalyticsEventRecord } from "./analytics-event";
import { createAnalyticsService, type GiftRefFactory } from "./analytics-service";

const now = new Date("2026-10-01T08:00:00.000Z");
const gift = { id: "gift-internal-1", templateId: "memory-box", templateVersion: "1.1.0" };
const giftRef: GiftRefFactory = (giftId) => `${giftId.length}`.padStart(43, "R");

function createService(enabled = true) {
  const inserted: AnalyticsEventRecord[] = [];
  const service = createAnalyticsService({
    createId: () => "event-1",
    events: {
      insert: vi.fn((record: AnalyticsEventRecord) => {
        inserted.push(record);
        return Promise.resolve();
      }),
    },
    giftRefFactory: () => (enabled ? giftRef : null),
  });
  return { inserted, service };
}

describe("analytics service", () => {
  it("returns the page context of a gift, or null while disabled", () => {
    expect(createService().service.contextForGift(gift)).toEqual({
      giftRef: giftRef(gift.id),
      templateId: "memory-box",
      templateVersion: "1.1.0",
    });
    expect(createService(false).service.contextForGift(gift)).toBeNull();
  });

  it("stores a validated browser event with the server time", async () => {
    const { inserted, service } = createService();
    await service.recordBrowserEvent(
      {
        giftRef: "G".repeat(43),
        name: "gift_open_interaction",
        sessionId: "9c1b2f0e-6a7d-4c90-8d7a-4a559c1b2f0e",
        templateId: "memory-box",
        templateVersion: "1.1.0",
      },
      now,
    );
    expect(inserted).toEqual([
      expect.objectContaining({
        _id: "event-1",
        giftRef: "G".repeat(43),
        name: "gift_open_interaction",
        occurredAt: now,
        sceneId: null,
      }),
    ]);
  });

  it("stores gift_published with the computed giftRef and no session", async () => {
    const { inserted, service } = createService();
    await expect(service.recordGiftPublished(gift, now)).resolves.toBe(true);
    expect(inserted).toEqual([
      expect.objectContaining({
        giftRef: giftRef(gift.id),
        name: "gift_published",
        sessionId: null,
        templateId: "memory-box",
        templateVersion: "1.1.0",
      }),
    ]);
    expect(JSON.stringify(inserted)).not.toContain(gift.id);
  });

  it("records no gift_published while disabled", async () => {
    const { inserted, service } = createService(false);
    await expect(service.recordGiftPublished(gift, now)).resolves.toBe(false);
    expect(inserted).toEqual([]);
  });
});
