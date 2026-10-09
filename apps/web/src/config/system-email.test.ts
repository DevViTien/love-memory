import { describe, expect, it } from "vitest";

import { parseSystemEmailEnvironment } from "./system-email";

const base = {
  APP_URL: "https://lovememory.example",
  AUTH_EMAIL_FROM: "LoveMemory <hello@lovememory.example>",
  RESEND_API_KEY: "re_test_key_123456",
};

describe("system email environment", () => {
  it("reads the provider, the sender and the public origin", () => {
    expect(parseSystemEmailEnvironment(base)).toEqual({
      appUrl: new URL("https://lovememory.example"),
      capturePath: null,
      emailFrom: "LoveMemory <hello@lovememory.example>",
      resendApiKey: "re_test_key_123456",
    });
  });

  it("allows the capture file only on a loopback origin", () => {
    expect(
      parseSystemEmailEnvironment({
        ...base,
        APP_URL: "http://127.0.0.1:3100",
        AUTH_EMAIL_CAPTURE_PATH: ".tmp/emails.jsonl",
      }).capturePath,
    ).toBe(".tmp/emails.jsonl");
    expect(() =>
      parseSystemEmailEnvironment({ ...base, AUTH_EMAIL_CAPTURE_PATH: ".tmp/emails.jsonl" }),
    ).toThrow("loopback");
  });

  it("refuses a missing origin, sender or key", () => {
    expect(() => parseSystemEmailEnvironment({ ...base, APP_URL: undefined })).toThrow();
    expect(() => parseSystemEmailEnvironment({ ...base, AUTH_EMAIL_FROM: "nobody" })).toThrow();
    expect(() => parseSystemEmailEnvironment({ ...base, RESEND_API_KEY: "short" })).toThrow();
  });
});
