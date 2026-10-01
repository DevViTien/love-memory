import { describe, expect, it } from "vitest";

import nextConfig from "../apps/web/next.config";

describe("next.config headers", () => {
  it("serves licensed audio files with immutable caching and nosniff", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const global = rules.find((rule) => rule.source === "/:path*");
    const audio = rules.find((rule) => rule.source === "/audio-library/:path*");

    expect(audio?.headers).toContainEqual({
      key: "Cache-Control",
      value: "public, max-age=31536000, immutable",
    });
    expect(global?.headers).toContainEqual({ key: "X-Content-Type-Options", value: "nosniff" });
  });
});
