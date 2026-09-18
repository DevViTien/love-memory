import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("memory box spike ESM route", () => {
  it("follows the technical-spike kill switch", async () => {
    vi.stubEnv("TECHNICAL_SPIKES_ENABLED", "false");
    expect(GET().status).toBe(404);
    vi.stubEnv("TECHNICAL_SPIKES_ENABLED", "true");
    vi.stubEnv("TECHNICAL_SPIKE_TOKEN", "a-development-token-with-32-characters");
    const response = GET();
    expect(response.headers.get("content-type")).toContain("javascript");
    await expect(response.text()).resolves.toContain("window.addEventListener");
  });
});
