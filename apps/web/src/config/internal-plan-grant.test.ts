import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getInternalPlanGrantEnvironment,
  parseInternalPlanGrantEnvironment,
} from "./internal-plan-grant";

describe("internal paid-plan grant flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    [{ INTERNAL_PLAN_GRANT_ENABLED: "true" }, true],
    [{ INTERNAL_PLAN_GRANT_ENABLED: "true", VERCEL_ENV: "preview" }, true],
    [{ INTERNAL_PLAN_GRANT_ENABLED: "false" }, false],
    [{}, false],
    [{ INTERNAL_PLAN_GRANT_ENABLED: "yes" }, false],
    [{ INTERNAL_PLAN_GRANT_ENABLED: "TRUE" }, false],
    [{ INTERNAL_PLAN_GRANT_ENABLED: "" }, false],
    [{ INTERNAL_PLAN_GRANT_ENABLED: "true", VERCEL_ENV: "production" }, false],
    // The Sprint 3 variable no longer grants anything.
    [{ INTERNAL_PUBLISH_ENABLED: "true" }, false],
  ])("reads %o as enabled=%s without throwing", (source, enabled) => {
    expect(() => parseInternalPlanGrantEnvironment(source)).not.toThrow();
    expect(parseInternalPlanGrantEnvironment(source)).toEqual({ enabled });
  });

  it("reads the process environment on every call", () => {
    vi.stubEnv("INTERNAL_PLAN_GRANT_ENABLED", "true");
    vi.stubEnv("VERCEL_ENV", "");
    expect(getInternalPlanGrantEnvironment()).toEqual({ enabled: true });

    vi.stubEnv("VERCEL_ENV", "production");
    expect(getInternalPlanGrantEnvironment()).toEqual({ enabled: false });
  });
});
