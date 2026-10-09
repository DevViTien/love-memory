import { describe, expect, it, vi } from "vitest";

import { consumeAll, type RateLimiter } from "./rate-limiter";

describe("consumeAll", () => {
  it("charges every subject while they allow, and stops at the first refusal", async () => {
    const consume = vi
      .fn<RateLimiter["consume"]>()
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 42 });

    await expect(consumeAll({ consume }, "gift-update", ["a", "b", "c"])).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 42,
    });
    expect(consume.mock.calls).toEqual([
      ["gift-update", "a"],
      ["gift-update", "b"],
    ]);
  });

  it("allows a request with no subject to charge", async () => {
    await expect(consumeAll({ consume: vi.fn() }, "gift-update", [])).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });
});
