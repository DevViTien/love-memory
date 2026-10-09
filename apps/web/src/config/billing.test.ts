import { describe, expect, it } from "vitest";

import { parseBillingEnvironment } from "./billing";

const APP_URL = "https://lovememory.example";
const payos = {
  APP_URL,
  BILLING_PROVIDER: "payos",
  PAYOS_API_KEY: "api-key",
  PAYOS_CHECKSUM_KEY: "checksum-key",
  PAYOS_CLIENT_ID: "client-id",
};

describe("billing environment", () => {
  it("is off when no provider is set", () => {
    expect(parseBillingEnvironment({ APP_URL })).toEqual({ kind: "off", reason: "not-configured" });
    expect(parseBillingEnvironment({ APP_URL, BILLING_PROVIDER: "" })).toMatchObject({
      kind: "off",
    });
  });

  it("reads payOS credentials, and is off when one is missing (Incomplete payOS configuration)", () => {
    expect(parseBillingEnvironment(payos)).toEqual({
      apiKey: "api-key",
      appUrl: new URL(APP_URL),
      checksumKey: "checksum-key",
      clientId: "client-id",
      kind: "payos",
    });
    expect(parseBillingEnvironment({ ...payos, PAYOS_CHECKSUM_KEY: "" })).toEqual({
      kind: "off",
      reason: "missing-payos-credentials",
    });
  });

  it("allows the fake provider only outside Vercel deployments (Fake refused on Vercel)", () => {
    expect(parseBillingEnvironment({ APP_URL, BILLING_PROVIDER: "fake" })).toEqual({
      appUrl: new URL(APP_URL),
      kind: "fake",
    });
    expect(
      parseBillingEnvironment({ APP_URL, BILLING_PROVIDER: "fake", VERCEL_ENV: "development" }),
    ).toMatchObject({ kind: "fake" });
    for (const VERCEL_ENV of ["preview", "production"]) {
      expect(parseBillingEnvironment({ APP_URL, BILLING_PROVIDER: "fake", VERCEL_ENV })).toEqual({
        kind: "off",
        reason: "fake-on-vercel",
      });
    }
  });

  it("is off for an unknown provider or an invalid origin, without throwing", () => {
    expect(parseBillingEnvironment({ APP_URL, BILLING_PROVIDER: "stripe" })).toEqual({
      kind: "off",
      reason: "unknown-provider",
    });
    expect(parseBillingEnvironment({ ...payos, APP_URL: "not a url" })).toEqual({
      kind: "off",
      reason: "invalid-app-url",
    });
  });
});
