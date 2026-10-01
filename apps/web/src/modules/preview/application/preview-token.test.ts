import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  generatePreviewToken,
  hashPreviewToken,
  isPreviewTokenFormat,
  PREVIEW_TOKEN_TTL_SECONDS,
} from "./preview-token";

describe("preview tokens", () => {
  it("generates 43-character base64url tokens from 32 random bytes", () => {
    const token = generatePreviewToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(generatePreviewToken()).not.toBe(token);
    expect(isPreviewTokenFormat(token)).toBe(true);
  });

  it("hashes to 64 lowercase hex characters that differ from the token", () => {
    const token = generatePreviewToken();
    const hash = hashPreviewToken(token);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toBe(token);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it.each([
    ["42 characters", "a".repeat(42)],
    ["44 characters", "a".repeat(44)],
    ["a plus sign", `${"a".repeat(42)}+`],
    ["a slash", `${"a".repeat(42)}/`],
    ["padding", `${"a".repeat(42)}=`],
    ["an empty string", ""],
  ])("rejects %s", (_name, token) => {
    expect(isPreviewTokenFormat(token)).toBe(false);
  });

  it("lives 30 minutes", () => {
    expect(PREVIEW_TOKEN_TTL_SECONDS).toBe(1800);
  });
});
