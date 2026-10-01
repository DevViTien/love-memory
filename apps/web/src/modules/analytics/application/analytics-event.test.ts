import { describe, expect, it } from "vitest";

import { ANALYTICS_RETENTION_DAYS, createAnalyticsEventRecord } from "./analytics-event";

const now = new Date("2026-10-01T08:00:00.000Z");
const giftRef = "R".repeat(43);
const sessionId = "9c1b2f0e-6a7d-4c90-8d7a-4a559c1b2f0e";
const base = { giftRef, sessionId, templateId: "memory-box", templateVersion: "1.1.0" } as const;

describe("analytics event record", () => {
  it("stores a scene event with exactly nine keys and a 180-day expiry", () => {
    const record = createAnalyticsEventRecord(
      { ...base, name: "scene_completed", sceneId: "memory-1" },
      "event-1",
      now,
    );

    expect(Object.keys(record).sort()).toEqual([
      "_id",
      "expiresAt",
      "giftRef",
      "name",
      "occurredAt",
      "sceneId",
      "sessionId",
      "templateId",
      "templateVersion",
    ]);
    expect(record).toEqual({
      _id: "event-1",
      expiresAt: new Date("2027-03-30T08:00:00.000Z"),
      giftRef,
      name: "scene_completed",
      occurredAt: now,
      sceneId: "memory-1",
      sessionId,
      templateId: "memory-box",
      templateVersion: "1.1.0",
    });
    expect(ANALYTICS_RETENTION_DAYS).toBe(180);
    expect(record.expiresAt.getTime() - record.occurredAt.getTime()).toBe(180 * 86_400_000);
  });

  it("stores sceneId null for every other browser event", () => {
    const record = createAnalyticsEventRecord({ ...base, name: "gift_completed" }, "event-2", now);
    expect(record.sceneId).toBeNull();
    expect(record.sessionId).toBe(sessionId);
  });

  it("stores sessionId null for the server publish event", () => {
    const record = createAnalyticsEventRecord(
      { giftRef, name: "gift_published", templateId: "memory-box", templateVersion: "1.1.0" },
      "event-3",
      now,
    );
    expect(record.sessionId).toBeNull();
    expect(record.sceneId).toBeNull();
    expect(Object.keys(record)).toHaveLength(9);
  });
});
