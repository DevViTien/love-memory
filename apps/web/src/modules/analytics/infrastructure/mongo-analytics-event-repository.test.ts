import type * as DatabaseModule from "@love-memory/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  collection: vi.fn(),
  getDatabase: vi.fn(),
  insertOne: vi.fn(),
}));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
}));

import { mongoAnalyticsEventRepository } from "./mongo-analytics-event-repository";

describe("Mongo analytics event repository", () => {
  beforeEach(() => {
    databaseMocks.insertOne.mockReset().mockResolvedValue({ acknowledged: true });
    databaseMocks.collection.mockReset().mockReturnValue({ insertOne: databaseMocks.insertOne });
    databaseMocks.getDatabase.mockReset().mockResolvedValue({
      collection: databaseMocks.collection,
    });
  });

  it("inserts the record into analyticsEvents unchanged", async () => {
    const record = {
      _id: "event-1",
      expiresAt: new Date("2027-03-30T08:00:00.000Z"),
      giftRef: "R".repeat(43),
      name: "gift_published" as const,
      occurredAt: new Date("2026-10-01T08:00:00.000Z"),
      sceneId: null,
      sessionId: null,
      templateId: "memory-box",
      templateVersion: "1.1.0",
    };

    await mongoAnalyticsEventRepository.insert(record);

    expect(databaseMocks.collection).toHaveBeenCalledWith("analyticsEvents");
    expect(databaseMocks.insertOne).toHaveBeenCalledWith(record);
  });

  it("lets a database error reach the caller", async () => {
    databaseMocks.insertOne.mockRejectedValue(new Error("down"));
    await expect(
      mongoAnalyticsEventRepository.insert({
        _id: "event-2",
        expiresAt: new Date(0),
        giftRef: "R".repeat(43),
        name: "gift_completed",
        occurredAt: new Date(0),
        sceneId: null,
        sessionId: "s",
        templateId: "memory-box",
        templateVersion: "1.1.0",
      }),
    ).rejects.toThrow("down");
  });
});
