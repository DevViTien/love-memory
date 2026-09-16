import { describe, expect, it } from "vitest";

import { parseAuthEnvironment } from "./auth-environment";

const valid = {
  AUTH_EMAIL_FROM: "LoveMemory <hello@example.com>",
  BETTER_AUTH_SECRET: "a-secure-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: "https://love.example.com",
  RESEND_API_KEY: "re_test_123456789",
};

describe("auth environment", () => {
  it("parses explicit passwordless authentication configuration", () => {
    expect(parseAuthEnvironment(valid)).toMatchObject({
      emailFrom: valid.AUTH_EMAIL_FROM,
      isProduction: false,
    });
  });

  it("requires secure production URLs and a high-entropy-length secret", () => {
    expect(() =>
      parseAuthEnvironment({ ...valid, BETTER_AUTH_SECRET: "short", NODE_ENV: "production" }),
    ).toThrow();
    expect(() =>
      parseAuthEnvironment({
        ...valid,
        BETTER_AUTH_URL: "http://love.example.com",
        NODE_ENV: "production",
      }),
    ).toThrow("HTTPS");
  });

  it("allows loopback HTTP for production-build browser tests", () => {
    expect(
      parseAuthEnvironment({
        ...valid,
        BETTER_AUTH_URL: "http://127.0.0.1:3100",
        NODE_ENV: "production",
      }).baseUrl.origin,
    ).toBe("http://127.0.0.1:3100");
  });
});
