import { describe, expect, it } from "vitest";

import { authorizeTechnicalSpike } from "./technical-spike-access";

const enabledEnvironment = {
  enabled: true,
  token: "a-development-token-with-32-characters",
} as const;

describe("technical spike access", () => {
  it("hides disabled spike endpoints", () => {
    expect(
      authorizeTechnicalSpike(new Request("https://example.test"), {
        enabled: false,
        token: undefined,
      }),
    ).toBe("disabled");
  });

  it("accepts only an exact bearer token", () => {
    expect(
      authorizeTechnicalSpike(
        new Request("https://example.test", {
          headers: { authorization: `Bearer ${enabledEnvironment.token}` },
        }),
        enabledEnvironment,
      ),
    ).toBe("authorized");

    expect(
      authorizeTechnicalSpike(
        new Request("https://example.test", {
          headers: { authorization: "Bearer wrong" },
        }),
        enabledEnvironment,
      ),
    ).toBe("unauthorized");
  });
});
