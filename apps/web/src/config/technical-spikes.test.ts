import { describe, expect, it } from "vitest";

import { parseTechnicalSpikeEnvironment } from "./technical-spikes";

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
});
