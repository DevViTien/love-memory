import type * as DatabaseModule from "@love-memory/database";
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  findOneAndUpdate: vi.fn(),
  getDatabase: vi.fn(),
}));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
}));

import { consumeGiftMutationRateLimit, giftRateLimitSubject } from "./mongo-gift-rate-limiter";

describe("Mongo gift mutation rate limiter", () => {
  beforeEach(() => {
    databaseMocks.findOneAndUpdate.mockReset();
    databaseMocks.getDatabase.mockReset();
    databaseMocks.getDatabase.mockResolvedValue({
      collection: () => ({ findOneAndUpdate: databaseMocks.findOneAndUpdate }),
    });
  });

  it("uses account, anonymous identity, then Vercel's trusted IP as stable subjects", () => {
    const request = new Request("https://love.example/api/gifts", {
      headers: {
        "x-forwarded-for": "198.51.100.8",
        "x-vercel-forwarded-for": "203.0.113.10, 10.0.0.1",
      },
    });

    expect(giftRateLimitSubject(request, { userId: "user-1" })).toBe("user:user-1");
    expect(giftRateLimitSubject(request, { anonymousDraftId: "draft-1" })).toBe(
      "anonymous:draft-1",
    );
    expect(giftRateLimitSubject(request, {})).toBe("ip:203.0.113.10");
    expect(
      giftRateLimitSubject(
        new Request("https://love.example/api/gifts", {
          headers: { "x-forwarded-for": "198.51.100.8" },
        }),
        {},
      ),
    ).toBeNull();
  });

  it("atomically consumes a bucket and returns its retry window", async () => {
    databaseMocks.findOneAndUpdate.mockResolvedValue({ count: 1 });
    const secret = "s".repeat(32);
    const expectedHash = createHmac("sha256", secret)
      .update("gift-mutation-rate-limit:ip:203.0.113.10")
      .digest("hex");

    await expect(
      consumeGiftMutationRateLimit("gift-create", "ip:203.0.113.10", secret, new Date(0)),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 600 });
    expect(databaseMocks.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: `gift-create:${expectedHash}:0`, count: { $lt: 10 } }),
      expect.objectContaining({ $inc: { count: 1 } }),
      { returnDocument: "after", upsert: true },
    );
  });

  it("treats a duplicate bucket upsert as a reached limit", async () => {
    databaseMocks.findOneAndUpdate.mockRejectedValue({ code: 11000 });

    await expect(
      consumeGiftMutationRateLimit("gift-update", "user:user-1", "s".repeat(32), new Date(0)),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 60 });
  });
});
