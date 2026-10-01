// @vitest-environment node
import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("next.config", () => {
  it("keeps signed local object URLs out of the development request log", () => {
    const logging = nextConfig.logging;
    const incomingRequests = logging ? logging.incomingRequests : undefined;
    const ignore =
      typeof incomingRequests === "object" ? (incomingRequests.ignore ?? []) : undefined;
    expect(ignore).toBeDefined();
    const ignored = (path: string) => ignore!.some((pattern) => pattern.test(path));
    expect(
      ignored(
        "/api/local-object-storage/private/assets/0f8fad5b-d9cb-469f-a165-70867728950e/source?expires=1&signature=x",
      ),
    ).toBe(true);
    expect(ignored("/api/media/uploads/init")).toBe(false);
    expect(ignored("/studio/abc")).toBe(false);
    expect(ignored(`/preview/${"a".repeat(43)}`)).toBe(true);
    expect(ignored("/previews")).toBe(false);
    expect(ignored(`/g/${"a".repeat(22)}`)).toBe(true);
    expect(ignored(`/api/public-gifts/${"a".repeat(22)}`)).toBe(true);
    expect(ignored("/gifts")).toBe(false);
    expect(ignored("/api/gifts/abc/publish")).toBe(false);
  });

  it("sends private, noindex and no-referrer headers on share links after the global entry", async () => {
    const entries = (await nextConfig.headers?.()) ?? [];
    const globalIndex = entries.findIndex((entry) => entry.source === "/:path*");
    const shareIndex = entries.findIndex((entry) => entry.source === "/g/:path*");

    expect(globalIndex).toBeGreaterThanOrEqual(0);
    expect(shareIndex).toBeGreaterThan(globalIndex);
    expect(entries[shareIndex]?.headers).toEqual([
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex" },
      { key: "Cache-Control", value: "private, no-store" },
    ]);
  });

  it("sends private, noindex and no-referrer headers on preview pages after the global entry", async () => {
    const entries = (await nextConfig.headers?.()) ?? [];
    const globalIndex = entries.findIndex((entry) => entry.source === "/:path*");
    const previewIndex = entries.findIndex((entry) => entry.source === "/preview/:path*");

    expect(globalIndex).toBeGreaterThanOrEqual(0);
    expect(previewIndex).toBeGreaterThan(globalIndex);
    expect(entries[previewIndex]?.headers).toEqual([
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex" },
      { key: "Cache-Control", value: "private, no-store" },
    ]);
  });

  it("keeps the existing security and caching headers", async () => {
    // arrayContaining: other changes may add entries; these must stay exactly as they are.
    expect(await nextConfig.headers?.()).toEqual(
      expect.arrayContaining([
        {
          headers: [
            { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "X-Frame-Options", value: "DENY" },
          ],
          source: "/:path*",
        },
        {
          headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
          source: "/template-spikes/:path*",
        },
        {
          headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
          source: "/template-artifacts/:path*",
        },
        {
          headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
          source: "/audio-library/:path*",
        },
      ]),
    );
  });
});
