import { twoFactor } from "better-auth/plugins";
import { describe, expect, it } from "vitest";

import { TWO_FACTOR_HTTP_PATHS, TWO_FACTOR_OPTIONS } from "./two-factor";

describe("two-factor plugin configuration", () => {
  it("disables every HTTP endpoint the plugin registers (Plugin endpoint unreachable)", () => {
    // Server-only endpoints (such as `generateTOTP`) have no path and no HTTP surface.
    const registered = Object.values(twoFactor(TWO_FACTOR_OPTIONS).endpoints)
      .map((endpoint) => endpoint.path as string | undefined)
      .filter((path): path is string => typeof path === "string")
      .sort();

    expect([...TWO_FACTOR_HTTP_PATHS].sort()).toEqual(registered);
  });

  it("uses passwordless TOTP with 10 backup codes in the twoFactors collection", () => {
    expect(TWO_FACTOR_OPTIONS).toMatchObject({
      allowPasswordless: true,
      backupCodeOptions: { amount: 10 },
      issuer: "LoveMemory",
      schema: { twoFactor: { modelName: "twoFactors" } },
      totpOptions: { digits: 6, period: 30 },
    });
  });
});
