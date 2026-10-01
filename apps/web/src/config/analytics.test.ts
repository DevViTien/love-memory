import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as AnalyticsModuleNamespace from "./analytics";

type AnalyticsModule = typeof AnalyticsModuleNamespace;

const goodSecret = "g".repeat(32);

describe("analytics configuration", () => {
  let analytics: AnalyticsModule;

  beforeEach(async () => {
    // The misconfiguration warning is once per process: a fresh module per test.
    vi.resetModules();
    analytics = await import("./analytics");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is enabled with the exact flag and a 32-character secret", () => {
    expect(
      analytics.parseAnalyticsEnvironment({
        ANALYTICS_ENABLED: "true",
        ANALYTICS_GIFT_REF_SECRET: goodSecret,
      }),
    ).toEqual({ enabled: true, giftRefSecret: goodSecret });
  });

  it.each([
    [{ ANALYTICS_ENABLED: "false", ANALYTICS_GIFT_REF_SECRET: goodSecret }],
    [{ ANALYTICS_GIFT_REF_SECRET: goodSecret }],
    [{ ANALYTICS_ENABLED: "TRUE", ANALYTICS_GIFT_REF_SECRET: goodSecret }],
    [{ ANALYTICS_ENABLED: "1", ANALYTICS_GIFT_REF_SECRET: goodSecret }],
    [{}],
  ])("reads %o as disabled without throwing or warning", (source) => {
    const sink = { warn: vi.fn() };
    expect(() => analytics.parseAnalyticsEnvironment(source, sink)).not.toThrow();
    expect(analytics.parseAnalyticsEnvironment(source, sink)).toEqual({
      enabled: false,
      giftRefSecret: null,
    });
    expect(sink.warn).not.toHaveBeenCalled();
  });

  it("disables a short or missing secret and warns once, never with the value", () => {
    const sink = { warn: vi.fn() };
    const shortSecret = "short-secret";
    expect(shortSecret).toHaveLength(12);

    expect(
      analytics.parseAnalyticsEnvironment(
        { ANALYTICS_ENABLED: "true", ANALYTICS_GIFT_REF_SECRET: shortSecret },
        sink,
      ),
    ).toEqual({ enabled: false, giftRefSecret: null });
    expect(analytics.parseAnalyticsEnvironment({ ANALYTICS_ENABLED: "true" }, sink)).toEqual({
      enabled: false,
      giftRefSecret: null,
    });

    expect(sink.warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(sink.warn.mock.calls);
    expect(logged).toContain("analytics_misconfigured");
    expect(logged).not.toContain(shortSecret);
  });

  it("reads the process environment on every call", () => {
    vi.stubEnv("ANALYTICS_ENABLED", "true");
    vi.stubEnv("ANALYTICS_GIFT_REF_SECRET", goodSecret);
    expect(analytics.getAnalyticsEnvironment().enabled).toBe(true);

    vi.stubEnv("ANALYTICS_ENABLED", "false");
    expect(analytics.getAnalyticsEnvironment().enabled).toBe(false);
  });
});
