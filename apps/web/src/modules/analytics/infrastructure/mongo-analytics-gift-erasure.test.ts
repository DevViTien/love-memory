import type * as DatabaseModule from "@love-memory/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
}));

import { createGiftRefFactory } from "./gift-ref";
import { createAnalyticsGiftErasure } from "./mongo-analytics-gift-erasure";

const giftId = "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89";

describe("analytics gift erasure", () => {
  const events = { deleteMany: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) => {
        expect(name).toBe("analyticsEvents");
        return events;
      },
    });
  });

  it("deletes the gift's events by its keyed giftRef", async () => {
    const secret = "s".repeat(32);

    await createAnalyticsGiftErasure(() => secret).deleteForGift(giftId);

    expect(events.deleteMany).toHaveBeenCalledWith({
      giftRef: createGiftRefFactory(secret)(giftId),
    });
  });

  it("does nothing without a configured secret", async () => {
    await createAnalyticsGiftErasure(() => null).deleteForGift(giftId);

    expect(events.deleteMany).not.toHaveBeenCalled();
  });
});
