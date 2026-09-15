import { describe, expect, it } from "vitest";

import { parseStorageEnvironment } from "./environment";

describe("storage environment", () => {
  it("uses Vercel OIDC credentials when available", () => {
    expect(
      parseStorageEnvironment({
        BLOB_READ_WRITE_TOKEN: "legacy-token",
        BLOB_STORE_ID: "store_abc123",
        VERCEL_OIDC_TOKEN: "oidc-token",
      }),
    ).toEqual({ oidcToken: "oidc-token", storeId: "store_abc123" });
  });

  it("supports the read-write token required for local development", () => {
    expect(parseStorageEnvironment({ BLOB_READ_WRITE_TOKEN: "local-token" })).toEqual({
      token: "local-token",
    });
  });

  it("rejects missing or incomplete credentials", () => {
    expect(() => parseStorageEnvironment({})).toThrow();
    expect(() => parseStorageEnvironment({ VERCEL_OIDC_TOKEN: "oidc-token" })).toThrow();
    expect(() => parseStorageEnvironment({ BLOB_STORE_ID: "store_abc123" })).toThrow();
  });
});
