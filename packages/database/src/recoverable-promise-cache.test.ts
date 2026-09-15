import { describe, expect, it, vi } from "vitest";

import { getOrCreateRecoverablePromise, type PromiseCache } from "./recoverable-promise-cache";

describe("recoverable promise cache", () => {
  it("shares one in-flight connection attempt", async () => {
    const cache: PromiseCache<string> = {};
    const factory = vi.fn(() => Promise.resolve("connected"));

    const first = getOrCreateRecoverablePromise(cache, factory);
    const second = getOrCreateRecoverablePromise(cache, factory);

    await expect(first).resolves.toBe("connected");
    await expect(second).resolves.toBe("connected");
    expect(factory).toHaveBeenCalledOnce();
  });

  it("clears a rejected attempt so a later request can recover", async () => {
    const cache: PromiseCache<string> = {};
    const factory = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce("connected");

    await expect(getOrCreateRecoverablePromise(cache, factory)).rejects.toThrow("temporary outage");
    await expect(getOrCreateRecoverablePromise(cache, factory)).resolves.toBe("connected");
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
