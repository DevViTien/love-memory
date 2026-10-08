import { type ClientSession, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";

import { enqueueJob } from "./job-outbox";

describe("enqueueJob", () => {
  it("upserts a pending job keyed by its deduplication key, in the caller's session", async () => {
    const updateOne = vi.fn(() => Promise.resolve({ upsertedCount: 1 }));
    const collection = vi.fn(() => ({ updateOne }));
    const database = { collection } as unknown as Db;
    const session = { id: "session-1" } as unknown as ClientSession;
    const now = new Date("2026-10-08T10:00:00.000Z");

    await enqueueJob(
      database,
      {
        deduplicationKey: "gift.assets.cleanup.v1:gift-1:9",
        now,
        payload: { giftId: "gift-1" },
        type: "gift.assets.cleanup.v1",
      },
      session,
    );

    expect(collection).toHaveBeenCalledWith("jobOutbox");
    expect(updateOne).toHaveBeenCalledWith(
      { deduplicationKey: "gift.assets.cleanup.v1:gift-1:9" },
      {
        $setOnInsert: {
          _id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
          attempts: 0,
          availableAt: now,
          createdAt: now,
          lastErrorCode: null,
          payload: { giftId: "gift-1" },
          status: "pending",
          type: "gift.assets.cleanup.v1",
          updatedAt: now,
        },
      },
      { session, upsert: true },
    );
  });

  it("runs without a session outside a transaction", async () => {
    const updateOne = vi.fn(() => Promise.resolve({ upsertedCount: 0 }));
    const database = { collection: () => ({ updateOne }) } as unknown as Db;

    await enqueueJob(database, {
      deduplicationKey: "k",
      now: new Date(),
      payload: {},
      type: "x.v1",
    });

    expect(updateOne).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      upsert: true,
    });
  });
});
