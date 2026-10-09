import { beforeEach, describe, expect, it, vi } from "vitest";

import { type AdminAccess, type AdminSession } from "../application/admin-access";
import { type AdminMfaService } from "../application/admin-mfa";
import {
  type AdminMfaRouteDependencies,
  handleAdminMfaEnroll,
  handleAdminMfaVerify,
} from "./admin-mfa-route-handlers";

const session: AdminSession = {
  sessionId: "session-1",
  user: { email: "admin@example.test", id: "user-1", role: "admin", twoFactorEnabled: false },
};

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3000${path}`, {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "x-request-id": "request-1",
      ...headers,
    },
    method: "POST",
  });
}

describe("admin MFA routes", () => {
  const getAccess = vi.fn<(headers: Headers) => Promise<AdminAccess>>();
  const consumeRateLimit = vi.fn<AdminMfaRouteDependencies["consumeRateLimit"]>();
  const enroll = vi.fn<AdminMfaService["enroll"]>();
  const verify = vi.fn<AdminMfaService["verify"]>();
  const limitAction = vi.fn(() => Promise.resolve({ allowed: true, retryAfterSeconds: 0 }));
  const dependencies: AdminMfaRouteDependencies = {
    consumeRateLimit,
    getAccess,
    mfa: { enroll, verify },
    limitAction,
  };
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    getAccess.mockResolvedValue({ kind: "needs-enrollment", session });
    consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  });

  describe("POST /api/admin/mfa/enroll", () => {
    it("answers 201 with exactly the URI, setup key and backup codes (First enrollment)", async () => {
      enroll.mockResolvedValueOnce({
        backupCodes: ["a1", "b2"],
        kind: "enrolled",
        setupKey: "ABC",
        totpUri: "otpauth://totp/LoveMemory:a?secret=ABC",
      });

      const response = await handleAdminMfaEnroll(post("/api/admin/mfa/enroll", {}), dependencies);

      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        data: {
          backupCodes: ["a1", "b2"],
          setupKey: "ABC",
          totpUri: "otpauth://totp/LoveMemory:a?secret=ABC",
        },
      });
      expect(enroll).toHaveBeenCalledWith(session, expect.any(Headers));
    });

    it("answers 409 MFA_ALREADY_ENABLED for an enabled factor (Re-enrollment refused)", async () => {
      enroll.mockResolvedValueOnce({ kind: "already-enabled" });

      const response = await handleAdminMfaEnroll(post("/api/admin/mfa/enroll", {}), dependencies);

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "CONFLICT", details: { reason: "MFA_ALREADY_ENABLED" } },
      });
    });

    it("answers 404 to a creator before reading anything (Creator cannot enroll)", async () => {
      getAccess.mockResolvedValueOnce({ kind: "none" });

      const response = await handleAdminMfaEnroll(
        post("/api/admin/mfa/enroll", "not json", { "content-type": "text/plain" }),
        dependencies,
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "NOT_FOUND" } });
      expect(enroll).not.toHaveBeenCalled();
    });

    it("refuses a foreign origin and a non-empty body", async () => {
      const foreign = await handleAdminMfaEnroll(
        post("/api/admin/mfa/enroll", {}, { origin: "https://evil.example" }),
        dependencies,
      );
      expect(foreign.status).toBe(403);

      const extra = await handleAdminMfaEnroll(
        post("/api/admin/mfa/enroll", { password: "x" }),
        dependencies,
      );
      expect(extra.status).toBe(400);
      expect(enroll).not.toHaveBeenCalled();
    });

    it("answers 500 with only the request id logged when the factor fails", async () => {
      enroll.mockRejectedValueOnce(new Error("secret material"));

      const response = await handleAdminMfaEnroll(post("/api/admin/mfa/enroll", {}), dependencies);

      expect(response.status).toBe(500);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("secret material");
    });
  });

  it("limits enrollment with the admin-action budget", async () => {
    limitAction.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 30 });

    const response = await handleAdminMfaEnroll(post("/api/admin/mfa/enroll", {}), dependencies);

    expect(response.status).toBe(429);
    expect(enroll).not.toHaveBeenCalled();
  });

  describe("POST /api/admin/mfa/verify", () => {
    it("answers 200 and forwards the rotated session cookie (Step-up with a TOTP code)", async () => {
      verify.mockResolvedValueOnce({
        kind: "verified",
        setCookies: ["better-auth.session_token=new; Path=/; HttpOnly"],
      });

      const response = await handleAdminMfaVerify(
        post("/api/admin/mfa/verify", { code: "123456" }),
        dependencies,
      );

      expect(response.status).toBe(200);
      expect(response.headers.getSetCookie()).toEqual([
        "better-auth.session_token=new; Path=/; HttpOnly",
      ]);
      expect(consumeRateLimit).toHaveBeenCalledWith("user:user-1");
      expect(verify).toHaveBeenCalledWith({
        code: "123456",
        headers: expect.any(Headers) as Headers,
        requestId: "request-1",
        session,
      });
    });

    it("answers 400 with fieldErrors.code for a wrong code (Wrong code)", async () => {
      verify.mockResolvedValueOnce({ kind: "invalid" });

      const response = await handleAdminMfaVerify(
        post("/api/admin/mfa/verify", { code: "000000" }),
        dependencies,
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { fieldErrors: { code: string } } };
      expect(body.error.fieldErrors.code).toBeTruthy();
      expect(JSON.stringify(body)).not.toContain("000000");
    });

    it("answers 429 while the factor is locked", async () => {
      verify.mockResolvedValueOnce({ kind: "locked", retryAfterSeconds: 600 });

      const response = await handleAdminMfaVerify(
        post("/api/admin/mfa/verify", { code: "123456" }),
        dependencies,
      );

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("600");
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "RATE_LIMITED", details: { retryAfterSeconds: 600 } },
      });
    });

    it("answers 429 before any check when the admin-mfa limit is spent (Admin step-up attempts limited)", async () => {
      consumeRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 120 });

      const response = await handleAdminMfaVerify(
        post("/api/admin/mfa/verify", { code: "123456" }),
        dependencies,
      );

      expect(response.status).toBe(429);
      expect(verify).not.toHaveBeenCalled();
    });

    it("refuses non-admins with 404 and malformed bodies with 400", async () => {
      getAccess.mockResolvedValueOnce({ kind: "none" });
      const creator = await handleAdminMfaVerify(
        post("/api/admin/mfa/verify", { code: "123456" }),
        dependencies,
      );
      expect(creator.status).toBe(404);
      expect(consumeRateLimit).not.toHaveBeenCalled();

      const malformed = await handleAdminMfaVerify(
        post("/api/admin/mfa/verify", { code: "123456", trustDevice: true }),
        dependencies,
      );
      expect(malformed.status).toBe(400);
      expect(verify).not.toHaveBeenCalled();
    });

    it("never logs the code when verification fails", async () => {
      verify.mockRejectedValueOnce(new Error("boom"));

      const response = await handleAdminMfaVerify(
        post("/api/admin/mfa/verify", { code: "654321" }),
        dependencies,
      );

      expect(response.status).toBe(500);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("654321");
    });
  });
});
