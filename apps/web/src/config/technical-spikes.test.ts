import { describe, expect, it } from "vitest";

import { isTechnicalSpikePagePath, parseTechnicalSpikeEnvironment } from "./technical-spikes";

describe("technical spike environment", () => {
  it("is disabled by default", () => {
    expect(parseTechnicalSpikeEnvironment({})).toEqual({ enabled: false, token: undefined });
  });

  it("requires a strong token when enabled", () => {
    expect(() => parseTechnicalSpikeEnvironment({ TECHNICAL_SPIKES_ENABLED: "true" })).toThrow();
    expect(
      parseTechnicalSpikeEnvironment({
        TECHNICAL_SPIKES_ENABLED: "true",
        TECHNICAL_SPIKE_TOKEN: "a-development-token-with-32-characters",
      }),
    ).toMatchObject({ enabled: true });
  });

  it.each([
    ["/studio/spikes", true],
    ["/studio/spikes/history", true],
    ["/template-spikes/memory-box", true],
    ["/studio/new", false],
    ["/templates", false],
  ])("classifies %s as technical-spike page: %s", (pathname, expected) => {
    expect(isTechnicalSpikePagePath(pathname)).toBe(expected);
  });
});
