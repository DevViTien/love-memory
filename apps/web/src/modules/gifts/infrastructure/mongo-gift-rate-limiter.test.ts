import type * as DatabaseModule from "@love-memory/database";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  findOneAndUpdate: vi.fn(),
  getDatabase: vi.fn(),
}));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
}));

import {
  analyticsSessionSubject,
  consumeApiRateLimit,
  giftRateLimitSubjects,
  publicReadLinkSubject,
  publicReadRateLimitSubject,
} from "./mongo-gift-rate-limiter";

describe("Mongo gift mutation rate limiter", () => {
  beforeEach(() => {
    databaseMocks.findOneAndUpdate.mockReset();
    databaseMocks.getDatabase.mockReset();
    databaseMocks.getDatabase.mockResolvedValue({
      collection: () => ({ findOneAndUpdate: databaseMocks.findOneAndUpdate }),
    });
    // The forwarding header is trusted only on Vercel.
    vi.stubEnv("VERCEL", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ignores x-vercel-forwarded-for off Vercel (Forwarding header off Vercel)", () => {
    vi.stubEnv("VERCEL", "");
    const request = new Request("https://love.example/api/gifts", {
      headers: { "x-vercel-forwarded-for": "203.0.113.10" },
    });

    expect(giftRateLimitSubjects(request, {})).toEqual(["unidentified"]);
    expect(giftRateLimitSubjects(request, { anonymousDraftId: "draft-1" })).toEqual([
      "anonymous:draft-1",
      "network:unidentified",
    ]);
    expect(publicReadRateLimitSubject(request)).toBe("unidentified");
  });

  it("uses account, anonymous identity, Vercel's trusted IP, then the shared unidentified subject", () => {
    const request = new Request("https://love.example/api/gifts", {
      headers: {
        "x-forwarded-for": "198.51.100.8",
        "x-vercel-forwarded-for": "203.0.113.10, 10.0.0.1",
      },
    });

    expect(giftRateLimitSubjects(request, { userId: "user-1" })).toEqual(["user:user-1"]);
    expect(giftRateLimitSubjects(request, { anonymousDraftId: "draft-1" })).toEqual([
      "anonymous:draft-1",
      "network:ip:203.0.113.10",
    ]);
    expect(giftRateLimitSubjects(request, {})).toEqual(["ip:203.0.113.10"]);
    expect(
      giftRateLimitSubjects(
        new Request("https://love.example/api/gifts", {
          headers: { "x-forwarded-for": "198.51.100.8" },
        }),
        {},
      ),
    ).toEqual(["unidentified"]);
    expect(
      giftRateLimitSubjects(new Request("https://love.example/api/gifts"), {
        anonymousDraftId: "draft-1",
      }),
    ).toEqual(["anonymous:draft-1", "network:unidentified"]);
  });

  it("atomically consumes a bucket and returns its retry window", async () => {
    databaseMocks.findOneAndUpdate.mockResolvedValue({ count: 1 });
    const secret = "s".repeat(32);
    const expectedHash = createHmac("sha256", secret)
      .update("gift-mutation-rate-limit:ip:203.0.113.10")
      .digest("hex");

    await expect(
      consumeApiRateLimit("gift-create", "ip:203.0.113.10", secret, new Date(0)),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 600 });
    expect(databaseMocks.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: `gift-create:${expectedHash}:0`, count: { $lt: 10 } }),
      expect.objectContaining({ $inc: { count: 1 } }),
      { returnDocument: "after", upsert: true },
    );
  });

  it.each(["unidentified", "network:ip:203.0.113.10", "network:unidentified"])(
    "gives the shared %s bucket five times the scope limit",
    async (subject) => {
      databaseMocks.findOneAndUpdate.mockResolvedValue({ count: 1 });

      await consumeApiRateLimit("gift-create", subject, "s".repeat(32), new Date(0));

      expect(databaseMocks.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ count: { $lt: 50 } }),
        expect.anything(),
        expect.anything(),
      );
    },
  );

  it("allows 30 gift-preview requests per 600-second window and refuses the 31st", async () => {
    // Emulate the atomic `count < max` upsert over one bucket.
    let count = 0;
    databaseMocks.findOneAndUpdate.mockImplementation((filter: { count: { $lt: number } }) => {
      if (count >= filter.count.$lt) return Promise.resolve(null);
      count += 1;
      return Promise.resolve({ count });
    });
    const now = new Date(1_200_000);
    const results = [];
    for (let attempt = 0; attempt < 31; attempt += 1) {
      results.push(await consumeApiRateLimit("gift-preview", "user:user-1", "s".repeat(32), now));
    }

    expect(results.slice(0, 30).every((result) => result.allowed)).toBe(true);
    expect(results[30]).toEqual({ allowed: false, retryAfterSeconds: 600 });
    const [filter, update] = databaseMocks.findOneAndUpdate.mock.lastCall as [
      { _id: string },
      { $setOnInsert: { scope: string } },
    ];
    expect(filter._id).toMatch(/^gift-preview:[a-f0-9]{64}:1200000$/);
    expect(update.$setOnInsert.scope).toBe("gift-preview");
  });

  it("gives the shared unidentified gift-preview bucket 150 requests", async () => {
    databaseMocks.findOneAndUpdate.mockResolvedValue({ count: 1 });

    await consumeApiRateLimit("gift-preview", "unidentified", "s".repeat(32), new Date(0));

    expect(databaseMocks.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ count: { $lt: 150 } }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("charges the counter a concurrent request created (Concurrent first requests in a new window)", async () => {
    databaseMocks.findOneAndUpdate
      .mockRejectedValueOnce({ code: 11000 })
      .mockResolvedValueOnce({ count: 2 });

    await expect(
      consumeApiRateLimit("gift-update", "user:user-1", "s".repeat(32), new Date(0)),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 60 });
    const [filter, update, options] = databaseMocks.findOneAndUpdate.mock.lastCall as [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(filter).toMatchObject({ count: { $lt: 60 } });
    expect(update).not.toHaveProperty("$setOnInsert");
    expect(options).toMatchObject({ upsert: false });
  });

  it("refuses when the counter is full after a duplicate key", async () => {
    databaseMocks.findOneAndUpdate
      .mockRejectedValueOnce({ code: 11000 })
      .mockResolvedValueOnce(null);

    await expect(
      consumeApiRateLimit("gift-update", "user:user-1", "s".repeat(32), new Date(0)),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it("rethrows any other database error", async () => {
    databaseMocks.findOneAndUpdate.mockRejectedValueOnce(new Error("down"));

    await expect(
      consumeApiRateLimit("gift-update", "user:user-1", "s".repeat(32), new Date(0)),
    ).rejects.toThrow("down");
  });

  describe("publish and public read limits", () => {
    const secret = "s".repeat(32);
    const now = new Date(1_200_000);

    function emulateBuckets() {
      // Emulate the atomic `count < max` upsert per bucket id.
      const counts = new Map<string, number>();
      databaseMocks.findOneAndUpdate.mockImplementation(
        (filter: { _id: string; count: { $lt: number } }) => {
          const count = counts.get(filter._id) ?? 0;
          if (count >= filter.count.$lt) return Promise.resolve(null);
          counts.set(filter._id, count + 1);
          return Promise.resolve({ count: count + 1 });
        },
      );
    }

    async function consumeMany(
      scope: Parameters<typeof consumeApiRateLimit>[0],
      subject: string,
      times: number,
    ) {
      const results = [];
      for (let attempt = 0; attempt < times; attempt += 1) {
        results.push(await consumeApiRateLimit(scope, subject, secret, now));
      }
      return results;
    }

    it("refuses the 11th publish in one 600-second window", async () => {
      emulateBuckets();
      const results = await consumeMany("gift-publish", "user:user-1", 11);

      expect(results.slice(0, 10).every((result) => result.allowed)).toBe(true);
      expect(results[10]).toEqual({ allowed: false, retryAfterSeconds: 600 });
    });

    it("refuses the 61st read of one share id from one address", async () => {
      emulateBuckets();
      const subject = publicReadLinkSubject("ip:203.0.113.10", "Ab0_-cdefghijklmnopqrs");
      const results = await consumeMany("public-gift-read", subject, 61);

      expect(results.slice(0, 60).every((result) => result.allowed)).toBe(true);
      expect(results[60]?.allowed).toBe(false);
    });

    it("refuses the 601st read across share ids from one address", async () => {
      emulateBuckets();
      const results = await consumeMany("public-gift-read-ip", "ip:203.0.113.10", 601);

      expect(results.slice(0, 600).every((result) => result.allowed)).toBe(true);
      expect(results[600]?.allowed).toBe(false);
    });

    it("lets 30 recipients behind one address open different gifts 3 times each", async () => {
      emulateBuckets();
      const outcomes = [];
      for (let gift = 0; gift < 30; gift += 1) {
        const shareId = `share${String(gift).padStart(17, "0")}`;
        for (let open = 0; open < 3; open += 1) {
          outcomes.push(
            await consumeApiRateLimit(
              "public-gift-read",
              publicReadLinkSubject("ip:203.0.113.10", shareId),
              secret,
              now,
            ),
            await consumeApiRateLimit("public-gift-read-ip", "ip:203.0.113.10", secret, now),
          );
        }
      }

      expect(outcomes).toHaveLength(180);
      expect(outcomes.every((outcome) => outcome.allowed)).toBe(true);
    });

    it("gives unidentified readers 300 reads per share id and 3000 in total", async () => {
      databaseMocks.findOneAndUpdate.mockResolvedValue({ count: 1 });

      await consumeApiRateLimit(
        "public-gift-read",
        publicReadLinkSubject("unidentified", "Ab0_-cdefghijklmnopqrs"),
        secret,
        now,
      );
      await consumeApiRateLimit("public-gift-read-ip", "unidentified", secret, now);

      const filters = databaseMocks.findOneAndUpdate.mock.calls.map(
        ([filter]) => (filter as { count: { $lt: number } }).count.$lt,
      );
      expect(filters).toEqual([300, 3000]);
    });

    it("never stores the share id or the address in plaintext", async () => {
      databaseMocks.findOneAndUpdate.mockResolvedValue({ count: 1 });

      await consumeApiRateLimit(
        "public-gift-read",
        publicReadLinkSubject("ip:203.0.113.10", "Ab0_-cdefghijklmnopqrs"),
        secret,
        now,
      );

      const serialized = JSON.stringify(databaseMocks.findOneAndUpdate.mock.lastCall);
      expect(serialized).not.toContain("Ab0_-cdefghijklmnopqrs");
      expect(serialized).not.toContain("203.0.113.10");
    });
  });

  describe("analytics event limits", () => {
    const secret = "s".repeat(32);
    const now = new Date(1_200_000);
    const sessionId = "9c1b2f0e-6a7d-4c90-8d7a-4a559c1b2f0e";

    function emulateBuckets() {
      const counts = new Map<string, number>();
      databaseMocks.findOneAndUpdate.mockImplementation(
        (filter: { _id: string; count: { $lt: number } }) => {
          const count = counts.get(filter._id) ?? 0;
          if (count >= filter.count.$lt) return Promise.resolve(null);
          counts.set(filter._id, count + 1);
          return Promise.resolve({ count: count + 1 });
        },
      );
    }

    it("refuses the 61st event of one session from one address (One tab floods events)", async () => {
      emulateBuckets();
      const subject = analyticsSessionSubject("ip:203.0.113.10", sessionId);
      expect(subject).toBe(`ip:203.0.113.10|session:${sessionId}`);
      const results = [];
      for (let attempt = 0; attempt < 61; attempt += 1) {
        results.push(await consumeApiRateLimit("analytics-event", subject, secret, now));
      }

      expect(results.slice(0, 60).every((result) => result.allowed)).toBe(true);
      expect(results[60]).toEqual({ allowed: false, retryAfterSeconds: 600 });
    });

    it("refuses the 1201st event across sessions from one address", async () => {
      emulateBuckets();
      const results = [];
      for (let attempt = 0; attempt < 1201; attempt += 1) {
        results.push(
          await consumeApiRateLimit("analytics-event-ip", "ip:203.0.113.10", secret, now),
        );
      }

      expect(results.slice(0, 1200).every((result) => result.allowed)).toBe(true);
      expect(results[1200]?.allowed).toBe(false);
    });

    it("gives unidentified clients 60 per session and 6000 in total", async () => {
      databaseMocks.findOneAndUpdate.mockResolvedValue({ count: 1 });

      await consumeApiRateLimit(
        "analytics-event",
        analyticsSessionSubject("unidentified", sessionId),
        secret,
        now,
      );
      await consumeApiRateLimit("analytics-event-ip", "unidentified", secret, now);

      const limits = databaseMocks.findOneAndUpdate.mock.calls.map(
        ([filter]) => (filter as { count: { $lt: number } }).count.$lt,
      );
      expect(limits).toEqual([60, 6000]);
    });

    it("keeps the multipliers of the existing scopes", async () => {
      databaseMocks.findOneAndUpdate.mockResolvedValue({ count: 1 });

      await consumeApiRateLimit(
        "public-gift-read",
        publicReadLinkSubject("unidentified", "Ab0_-cdefghijklmnopqrs"),
        secret,
        now,
      );
      await consumeApiRateLimit("gift-update", "network:unidentified", secret, now);
      await consumeApiRateLimit("gift-update", "user:user-1", secret, now);

      const limits = databaseMocks.findOneAndUpdate.mock.calls.map(
        ([filter]) => (filter as { count: { $lt: number } }).count.$lt,
      );
      expect(limits).toEqual([300, 300, 60]);
    });

    it("never stores the session id or the address in plaintext", async () => {
      databaseMocks.findOneAndUpdate.mockResolvedValue({ count: 1 });

      await consumeApiRateLimit(
        "analytics-event",
        analyticsSessionSubject("ip:203.0.113.10", sessionId),
        secret,
        now,
      );

      const serialized = JSON.stringify(databaseMocks.findOneAndUpdate.mock.lastCall);
      expect(serialized).not.toContain(sessionId);
      expect(serialized).not.toContain("203.0.113.10");
    });
  });

  describe("publicReadRateLimitSubject", () => {
    function request(headers: Record<string, string>) {
      return new Request("https://love.example/api/public-gifts/x", { headers });
    }

    it("uses a trusted IPv4 address as is", () => {
      expect(
        publicReadRateLimitSubject(request({ "x-vercel-forwarded-for": "203.0.113.10, 10.0.0.1" })),
      ).toBe("ip:203.0.113.10");
    });

    it("charges IPv6 addresses of one /64 to one subject", () => {
      const subjects = ["2001:db8:1:2::a", "2001:DB8:1:2:0:0:0:b", "2001:db8:1:2::b"].map(
        (address) => publicReadRateLimitSubject(request({ "x-vercel-forwarded-for": address })),
      );

      expect(new Set(subjects)).toEqual(new Set(["ip6:2001:db8:1:2::/64"]));
      expect(
        publicReadRateLimitSubject(request({ "x-vercel-forwarded-for": "2001:db8:1:3::a" })),
      ).toBe("ip6:2001:db8:1:3::/64");
    });

    it("expands compressed and IPv4-mapped IPv6 addresses", () => {
      expect(publicReadRateLimitSubject(request({ "x-vercel-forwarded-for": "::1" }))).toBe(
        "ip6:0:0:0:0::/64",
      );
      expect(
        publicReadRateLimitSubject(request({ "x-vercel-forwarded-for": "::ffff:192.0.2.1" })),
      ).toBe("ip:192.0.2.1");
      expect(publicReadRateLimitSubject(request({ "x-vercel-forwarded-for": "2001:db8::" }))).toBe(
        "ip6:2001:db8:0:0::/64",
      );
    });

    it("ignores sessions, cookies and the untrusted x-forwarded-for header", () => {
      expect(
        publicReadRateLimitSubject(
          request({
            cookie: "better-auth.session_token=abc; lm_anonymous_draft=xyz",
            "x-forwarded-for": "198.51.100.8",
          }),
        ),
      ).toBe("unidentified");
      expect(publicReadRateLimitSubject(request({ "x-vercel-forwarded-for": "not-an-ip" }))).toBe(
        "unidentified",
      );
    });
  });
});
