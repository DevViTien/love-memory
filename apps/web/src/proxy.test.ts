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

  it("sends the nonce policy for preview links, valid or not", () => {
    const response = proxy(new NextRequest(`https://example.test/preview/${"a".repeat(43)}`));
    const policy = response.headers.get("content-security-policy") ?? "";

    expect(policy).toContain("'strict-dynamic'");
    expect(policy).toMatch(/'nonce-[^']+'/);
  });

  it.each(["/previews", "/preview-guide"])("keeps look-alike path %s static", (pathname) => {
    const policy =
      proxy(new NextRequest(`https://example.test${pathname}`)).headers.get(
        "content-security-policy",
      ) ?? "";

    expect(policy).not.toContain("'strict-dynamic'");
    expect(policy).not.toContain("'nonce-");
  });

  it("lists the local storage origin only for an allowed local configuration", () => {
    vi.stubEnv("STORAGE_DRIVER", "local");
    vi.stubEnv("APP_URL", "http://127.0.0.1:3100");
    vi.stubEnv("LOCAL_OBJECT_STORAGE_SECRET", "proxy-local-object-storage-secret-0001");
    vi.stubEnv("VERCEL_ENV", "");
    const policy = () =>
      proxy(new NextRequest("https://example.test/studio/abc")).headers.get(
        "content-security-policy",
      ) ?? "";

    expect(policy()).toContain("http://127.0.0.1:3100");

    for (const vercelEnvironment of ["production", "preview"]) {
      vi.stubEnv("VERCEL_ENV", vercelEnvironment);
      expect(policy()).not.toContain("http://127.0.0.1:3100");
    }

    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("STORAGE_DRIVER", "");
    expect(policy()).not.toContain("http://127.0.0.1:3100");
  });
});
