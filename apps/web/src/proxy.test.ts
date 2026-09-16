import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "./proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("application proxy", () => {
  it.each(["/studio/spikes", "/template-spikes/memory-box"])(
    "returns a hard 404 for disabled technical page %s",
    (pathname) => {
      vi.stubEnv("TECHNICAL_SPIKES_ENABLED", "false");

      const response = proxy(new NextRequest(`https://example.test${pathname}`));

      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );

  it("allows an enabled technical page to continue", () => {
    vi.stubEnv("TECHNICAL_SPIKES_ENABLED", "true");
    vi.stubEnv("TECHNICAL_SPIKE_TOKEN", "a-development-token-with-32-characters");

    const response = proxy(new NextRequest("https://example.test/studio/spikes"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
