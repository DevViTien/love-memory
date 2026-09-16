import { describe, expect, it } from "vitest";

import {
  ANONYMOUS_DRAFT_COOKIE,
  createAnonymousDraftIdentity,
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
});
