import { describe, expect, it } from "vitest";

import { canManageOwner, createSessionService, type CurrentUser } from "./session";

const creator: CurrentUser = {
  email: "creator@example.com",
  id: "creator-1",
  name: "Creator",
  role: "creator",
};

describe("authorization helpers", () => {
  it("allows owners and admins but rejects another creator", () => {
    expect(canManageOwner(creator, "creator-1")).toBe(true);
    expect(canManageOwner(creator, "creator-2")).toBe(false);
    expect(canManageOwner({ ...creator, role: "admin" }, "creator-2")).toBe(true);
  });

  it("maps a valid provider session and rejects an absent session", async () => {
    const authenticated = createSessionService({
      getSession: () => Promise.resolve({ session: { id: "session-1" }, user: creator }),
    });
    const anonymous = createSessionService({ getSession: () => Promise.resolve(null) });
    const requestHeaders = new Headers();

    await expect(authenticated.getCurrentUser(requestHeaders)).resolves.toEqual(creator);
    await expect(authenticated.verifySession(requestHeaders)).resolves.toEqual(creator);
    await expect(anonymous.getCurrentUser(requestHeaders)).resolves.toBeNull();
    await expect(anonymous.verifySession(requestHeaders)).rejects.toThrow(
      "AUTHENTICATION_REQUIRED",
    );
  });

  it("treats malformed provider data as no session", async () => {
    const sessions = createSessionService({ getSession: () => Promise.resolve({ invalid: true }) });

    await expect(sessions.getCurrentUser(new Headers())).resolves.toBeNull();
  });

  it("accepts the empty display name created by passwordless sign-up", async () => {
    const passwordlessUser = { ...creator, name: "" };
    const sessions = createSessionService({
      getSession: () => Promise.resolve({ session: { id: "session-1" }, user: passwordlessUser }),
    });

    await expect(sessions.getCurrentUser(new Headers())).resolves.toEqual(passwordlessUser);
  });
});
