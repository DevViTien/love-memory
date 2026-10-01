import { afterEach, describe, expect, it, vi } from "vitest";

import { getInternalPublishEnvironment, parseInternalPublishEnvironment } from "./internal-publish";

describe("internal publish entitlement flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    [{ INTERNAL_PUBLISH_ENABLED: "true" }, true],
    [{ INTERNAL_PUBLISH_ENABLED: "true", VERCEL_ENV: "preview" }, true],
    [{ INTERNAL_PUBLISH_ENABLED: "false" }, false],
    [{}, false],
    [{ INTERNAL_PUBLISH_ENABLED: "TRUE" }, false],
    [{ INTERNAL_PUBLISH_ENABLED: "1" }, false],
    [{ INTERNAL_PUBLISH_ENABLED: "" }, false],
    [{ INTERNAL_PUBLISH_ENABLED: "true", VERCEL_ENV: "production" }, false],
  ])("reads %o as enabled=%s without throwing", (source, enabled) => {
    expect(() => parseInternalPublishEnvironment(source)).not.toThrow();
    expect(parseInternalPublishEnvironment(source)).toEqual({ enabled });
  });

  it("reads the process environment on every call", () => {
    vi.stubEnv("INTERNAL_PUBLISH_ENABLED", "true");
    vi.stubEnv("VERCEL_ENV", "");
    expect(getInternalPublishEnvironment()).toEqual({ enabled: true });

    vi.stubEnv("VERCEL_ENV", "production");
    expect(getInternalPublishEnvironment()).toEqual({ enabled: false });
  });
});
