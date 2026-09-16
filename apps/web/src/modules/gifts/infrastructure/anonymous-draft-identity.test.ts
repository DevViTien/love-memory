import { describe, expect, it } from "vitest";

import {
  ANONYMOUS_DRAFT_COOKIE,
  createAnonymousDraftIdentity,
  createIdempotentAnonymousDraftIdentity,
  parseAnonymousDraftIdentity,
  readCookie,
  serializeAnonymousDraftCookie,
} from "./anonymous-draft-identity";

describe("anonymous draft identity", () => {
  it("round-trips a high-entropy identity through an HttpOnly cookie", () => {
    const identity = createAnonymousDraftIdentity();
    const serialized = serializeAnonymousDraftCookie(identity);
    const cookieValue = serialized.split(";")[0]?.split("=")[1];

    expect(serialized).toContain("HttpOnly");
    expect(serialized).toContain("SameSite=Lax");
    expect(parseAnonymousDraftIdentity(cookieValue)).toEqual(identity);
  });

  it("rejects malformed values and reads only the requested cookie", () => {
    const request = new Request("https://example.com", {
      headers: { cookie: `other=x; ${ANONYMOUS_DRAFT_COOKIE}=invalid` },
    });

    expect(readCookie(request, ANONYMOUS_DRAFT_COOKIE)).toBe("invalid");
    expect(parseAnonymousDraftIdentity("invalid")).toBeNull();
  });

  it("derives stable, purpose-separated credentials for idempotent retries", () => {
    const first = createIdempotentAnonymousDraftIdentity("request-1", "s".repeat(32));
    const retry = createIdempotentAnonymousDraftIdentity("request-1", "s".repeat(32));
    const other = createIdempotentAnonymousDraftIdentity("request-2", "s".repeat(32));

    expect(retry).toEqual(first);
    expect(other).not.toEqual(first);
    expect(first.anonymousDraftId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.claimToken).toHaveLength(43);
    expect(first.claimTokenHash).toHaveLength(64);
  });
});
