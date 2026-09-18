import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("memory box spike artifact route", () => {
  it("is unavailable when technical spikes are disabled", () => {
    vi.stubEnv("TECHNICAL_SPIKES_ENABLED", "false");

    const response = GET();

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("serves an uncached artifact only when technical spikes are enabled", async () => {
    vi.stubEnv("TECHNICAL_SPIKES_ENABLED", "true");
    vi.stubEnv("TECHNICAL_SPIKE_TOKEN", "a-development-token-with-32-characters");

    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.text()).resolves.toContain('src="runtime.mjs"');
  });
});
