import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWithTimeout } from "./fetch-with-timeout";
import { hangingFetch } from "./test/hanging-fetch";

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchWithTimeout", () => {
  it("aborts a request that has not answered in time", async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    const pending = fetchWithTimeout(fetchMock, "/api/x", { method: "POST" }, 15_000);
    const settled = expect(pending).rejects.toThrow("aborted");

    await vi.advanceTimersByTimeAsync(14_999);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it("returns a response that arrives in time and clears its timer", async () => {
    vi.useFakeTimers();
    const response = new Response(null, { status: 204 });
    const fetchMock = vi.fn(() => Promise.resolve(response));

    await expect(fetchWithTimeout(fetchMock, "/api/x", {}, 15_000)).resolves.toBe(response);
    expect(vi.getTimerCount()).toBe(0);
  });
});
