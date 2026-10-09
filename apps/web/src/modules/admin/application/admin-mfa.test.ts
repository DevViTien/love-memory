import { beforeEach, describe, expect, it, vi } from "vitest";

import { type AdminSession, stepUpKey } from "./admin-access";
import { type AdminFactorProvider, createAdminMfaService } from "./admin-mfa";

const now = new Date("2026-10-09T10:00:00.000Z");
const headers = new Headers({ cookie: "session=1" });

function adminSession(twoFactorEnabled: boolean): AdminSession {
  return {
    sessionId: "session-1",
    user: { email: "admin@example.test", id: "user-1", role: "admin", twoFactorEnabled },
  };
}

describe("admin MFA service", () => {
  const record = vi.fn();
  const stepUpRecord = vi.fn();
  const enable = vi.fn<AdminFactorProvider["enable"]>();
  const verifyFactor = vi.fn<AdminFactorProvider["verify"]>();
  const lockedUntil = vi.fn<(userId: string, now: Date) => Promise<Date | null>>();
  const recordFailure = vi.fn();
  const clear = vi.fn();
  const service = createAdminMfaService({
    audit: { record },
    clock: () => now,
    factor: { enable, verify: verifyFactor },
    lockout: { clear, lockedUntil, recordFailure },
    stepUps: { record: stepUpRecord },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    lockedUntil.mockResolvedValue(null);
  });

  it("returns the URI, its setup key and the backup codes (First enrollment)", async () => {
    enable.mockResolvedValueOnce({
      backupCodes: ["a1", "b2"],
      totpUri:
        "otpauth://totp/LoveMemory:admin%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=LoveMemory",
    });

    await expect(service.enroll(adminSession(false), headers)).resolves.toEqual({
      backupCodes: ["a1", "b2"],
      kind: "enrolled",
      setupKey: "JBSWY3DPEHPK3PXP",
      totpUri:
        "otpauth://totp/LoveMemory:admin%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=LoveMemory",
    });
    expect(enable).toHaveBeenCalledWith(headers);
  });

  it("refuses to enroll again once a factor is enabled (Re-enrollment refused)", async () => {
    await expect(service.enroll(adminSession(true), headers)).resolves.toEqual({
      kind: "already-enabled",
    });
    expect(enable).not.toHaveBeenCalled();
  });

  it("fails loudly on a URI without a secret", async () => {
    enable.mockResolvedValueOnce({ backupCodes: ["a1"], totpUri: "otpauth://totp/LoveMemory" });

    await expect(service.enroll(adminSession(false), headers)).rejects.toThrow(
      "TOTP_URI_WITHOUT_SECRET",
    );
  });

  it("records a step-up and admin.mfa.verified for a valid code (Step-up with a TOTP code)", async () => {
    verifyFactor.mockResolvedValueOnce({ ok: true, sessionId: "session-1", setCookies: [] });

    await expect(
      service.verify({ code: "123456", headers, requestId: "r-1", session: adminSession(true) }),
    ).resolves.toEqual({ kind: "verified", setCookies: [] });

    expect(verifyFactor).toHaveBeenCalledWith({
      code: "123456",
      headers,
      method: "totp",
      sessionId: "session-1",
    });
    expect(clear).toHaveBeenCalledWith("user-1");
    expect(stepUpRecord).toHaveBeenCalledWith(
      expect.objectContaining({ key: stepUpKey("session-1"), userId: "user-1" }),
      expect.objectContaining({
        action: "admin.mfa.verified",
        actor: { id: "user-1", kind: "admin" },
        metadata: { method: "totp" },
        requestId: "r-1",
        target: { id: "user-1", kind: "user" },
      }),
    );
  });

  it("records admin.mfa.enrolled for the first code, bound to the rotated session", async () => {
    verifyFactor.mockResolvedValueOnce({
      ok: true,
      sessionId: "session-2",
      setCookies: ["better-auth.session_token=new; Path=/; HttpOnly"],
    });

    await expect(
      service.verify({ code: "123456", headers, requestId: "r-1", session: adminSession(false) }),
    ).resolves.toEqual({
      kind: "verified",
      setCookies: ["better-auth.session_token=new; Path=/; HttpOnly"],
    });
    expect(stepUpRecord).toHaveBeenCalledWith(
      expect.objectContaining({ key: stepUpKey("session-2") }),
      expect.objectContaining({ action: "admin.mfa.enrolled" }),
    );
  });

  it("routes a backup code to the backup check, but never before the factor is enabled", async () => {
    verifyFactor.mockResolvedValueOnce({ ok: true, sessionId: "session-1", setCookies: [] });

    await service.verify({
      code: "abcde-12345",
      headers,
      requestId: "r-1",
      session: adminSession(true),
    });
    expect(verifyFactor).toHaveBeenCalledWith(expect.objectContaining({ method: "backup" }));

    verifyFactor.mockClear();
    await expect(
      service.verify({
        code: "abcde-12345",
        headers,
        requestId: "r-1",
        session: adminSession(false),
      }),
    ).resolves.toEqual({ kind: "invalid" });
    expect(verifyFactor).not.toHaveBeenCalled();
  });

  it("counts and audits a wrong code without recording it (Wrong code)", async () => {
    verifyFactor.mockResolvedValueOnce({ ok: false });

    await expect(
      service.verify({ code: "000000", headers, requestId: "r-1", session: adminSession(true) }),
    ).resolves.toEqual({ kind: "invalid" });

    expect(recordFailure).toHaveBeenCalledWith("user-1", now);
    expect(stepUpRecord).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      {
        action: "admin.mfa.failed",
        actor: { id: "user-1", kind: "admin" },
        metadata: { method: "totp", reason: "invalid" },
        target: { id: "user-1", kind: "user" },
      },
      "r-1",
    );
    expect(JSON.stringify(record.mock.calls)).not.toContain("000000");
  });

  it("refuses every code while the factor is locked, even before checking it", async () => {
    lockedUntil.mockResolvedValueOnce(new Date(now.getTime() + 90_500));

    await expect(
      service.verify({ code: "123456", headers, requestId: "r-1", session: adminSession(true) }),
    ).resolves.toEqual({ kind: "locked", retryAfterSeconds: 91 });

    expect(verifyFactor).not.toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.mfa.failed",
        metadata: { method: "totp", reason: "locked" },
      }),
      "r-1",
    );
  });
});
