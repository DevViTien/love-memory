import { afterEach, describe, expect, it, vi } from "vitest";

import { getWebEnvironment, parseWebEnvironment } from "./environment";

afterEach(() => vi.unstubAllEnvs());

describe("web environment", () => {
  it("normalizes configured URLs and their origins", () => {
    expect(
      parseWebEnvironment({
        APP_URL: "https://love.example/path",
        ASSET_ORIGIN: "https://cdn.example/assets",
      }),
    ).toEqual({
      appUrl: new URL("https://love.example/path"),
      assetOrigin: "https://cdn.example",
    });
  });

  it("treats optional empty values as missing", () => {
    expect(parseWebEnvironment({ APP_URL: "", ASSET_ORIGIN: "" })).toEqual({
      appUrl: undefined,
      assetOrigin: undefined,
    });
  });

  it.each(["javascript:alert(1)", "ftp://cdn.example"])("rejects non-HTTP URL %s", (url) => {
    expect(() => parseWebEnvironment({ ASSET_ORIGIN: url })).toThrow();
  });

  it("reads process values through the validated boundary", () => {
    vi.stubEnv("APP_URL", "https://love.example");

    expect(getWebEnvironment().appUrl).toEqual(new URL("https://love.example"));
  });
});
