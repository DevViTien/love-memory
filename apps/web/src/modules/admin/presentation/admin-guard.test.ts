import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));

vi.mock("next/navigation", () => navigation);

import { type AdminAccess, type AdminSession } from "../application/admin-access";
import { requireAdminRoute, requireAdminForMfa, requireAdminPage } from "./admin-guard";

const session: AdminSession = {
  sessionId: "session-1",
  user: { email: "admin@example.test", id: "user-1", role: "admin", twoFactorEnabled: true },
};
const none: AdminAccess = { kind: "none" };
const needsStepUp: AdminAccess = { kind: "needs-step-up", session };
const needsEnrollment: AdminAccess = { kind: "needs-enrollment", session };
const admin: AdminAccess = { kind: "admin", session };

describe("admin page guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders not-found for non-admins (Creator sees nothing)", () => {
    expect(() => requireAdminPage(none)).toThrow("NEXT_NOT_FOUND");
    expect(() => requireAdminForMfa(none)).toThrow("NEXT_NOT_FOUND");
  });

  it("sends an admin without a factor or a step-up to /admin/mfa (Admin without a step-up)", () => {
    expect(() => requireAdminPage(needsStepUp)).toThrow("NEXT_REDIRECT /admin/mfa");
    expect(() => requireAdminPage(needsEnrollment)).toThrow("NEXT_REDIRECT /admin/mfa");
  });

  it("lets a stepped-up admin in, and any admin onto the MFA page", () => {
    expect(requireAdminPage(admin)).toBe(session);
    expect(requireAdminForMfa(needsEnrollment)).toBe(needsEnrollment);
    expect(requireAdminForMfa(needsStepUp)).toBe(needsStepUp);
  });
});

describe("admin route guard", () => {
  it("answers non-admins exactly like an unknown API path (Creator cannot enroll)", async () => {
    const refusal = requireAdminRoute(none, { allowMfa: true, requestId: "request-1" });

    expect(refusal).toBeInstanceOf(Response);
    expect((refusal as Response).status).toBe(404);
    await expect((refusal as Response).json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  it("answers 403 MFA_REQUIRED outside the MFA flow (Admin API without a step-up)", async () => {
    const refusal = requireAdminRoute(needsStepUp, { allowMfa: false, requestId: "request-1" });

    expect((refusal as Response).status).toBe(403);
    await expect((refusal as Response).json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN", details: { reason: "MFA_REQUIRED" } },
    });
  });

  it("lets the MFA routes and stepped-up admins through", () => {
    expect(requireAdminRoute(needsEnrollment, { allowMfa: true, requestId: "r" })).toBe(session);
    expect(requireAdminRoute(admin, { allowMfa: false, requestId: "r" })).toBe(session);
  });
});
