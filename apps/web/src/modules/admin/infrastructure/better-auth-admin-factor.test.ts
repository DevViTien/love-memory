import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBetterAuthAdminFactor, type TwoFactorServerApi } from "./better-auth-admin-factor";

const headers = new Headers({ cookie: "better-auth.session_token=old" });

describe("Better Auth admin factor", () => {
  const enableTwoFactor = vi.fn<TwoFactorServerApi["enableTwoFactor"]>();
  const getSession = vi.fn<TwoFactorServerApi["getSession"]>();
  const verifyBackupCode = vi.fn<TwoFactorServerApi["verifyBackupCode"]>();
  const verifyTOTP = vi.fn<TwoFactorServerApi["verifyTOTP"]>();
  const factor = createBetterAuthAdminFactor(() =>
    Promise.resolve({ enableTwoFactor, getSession, verifyBackupCode, verifyTOTP }),
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enables a TOTP factor on the server and validates the plugin's answer", async () => {
    enableTwoFactor.mockResolvedValueOnce({
      backupCodes: ["a1"],
      method: "totp",
      totpURI: "otpauth://totp/LoveMemory:a?secret=ABC",
    });

    await expect(factor.enable(headers)).resolves.toEqual({
      backupCodes: ["a1"],
      totpUri: "otpauth://totp/LoveMemory:a?secret=ABC",
    });
    expect(enableTwoFactor).toHaveBeenCalledWith({ body: { method: "totp" }, headers });

    enableTwoFactor.mockResolvedValueOnce({ method: "otp" });
    await expect(factor.enable(headers)).rejects.toThrow();
  });

  it("keeps the current session when the plugin sets no cookie", async () => {
    verifyTOTP.mockResolvedValueOnce({ headers: new Headers() });

    await expect(
      factor.verify({ code: "123456", headers, method: "totp", sessionId: "session-1" }),
    ).resolves.toEqual({ ok: true, sessionId: "session-1", setCookies: [] });
    expect(verifyTOTP).toHaveBeenCalledWith({
      body: { code: "123456" },
      headers,
      returnHeaders: true,
    });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("follows the session the first code rotates to", async () => {
    const rotated = new Headers();
    rotated.append("Set-Cookie", "better-auth.session_token=new.sig; Path=/; HttpOnly");
    rotated.append("Set-Cookie", "better-auth.session_data=; Max-Age=0");
    verifyTOTP.mockResolvedValueOnce({ headers: rotated });
    getSession.mockResolvedValueOnce({ session: { id: "session-2" }, user: { id: "user-1" } });

    const verified = await factor.verify({
      code: "123456",
      headers,
      method: "totp",
      sessionId: "session-1",
    });

    expect(verified).toEqual({
      ok: true,
      sessionId: "session-2",
      setCookies: [
        "better-auth.session_token=new.sig; Path=/; HttpOnly",
        "better-auth.session_data=; Max-Age=0",
      ],
    });
    const lookup = getSession.mock.calls[0]?.[0];
    expect(lookup?.headers.get("cookie")).toBe(
      "better-auth.session_token=new.sig; better-auth.session_data=",
    );
  });

  it("falls back to the current session when the new cookie reads no session", async () => {
    const rotated = new Headers({ "Set-Cookie": "other=1; Path=/" });
    verifyTOTP.mockResolvedValueOnce({ headers: rotated });
    getSession.mockResolvedValueOnce(null);

    await expect(
      factor.verify({ code: "123456", headers, method: "totp", sessionId: "session-1" }),
    ).resolves.toMatchObject({ ok: true, sessionId: "session-1" });
  });

  it("uses the backup-code check for a backup code", async () => {
    verifyBackupCode.mockResolvedValueOnce({ headers: new Headers() });

    await factor.verify({ code: "abcde-12345", headers, method: "backup", sessionId: "s" });

    expect(verifyBackupCode).toHaveBeenCalledWith({
      body: { code: "abcde-12345" },
      headers,
      returnHeaders: true,
    });
    expect(verifyTOTP).not.toHaveBeenCalled();
  });

  it("treats the plugin's 400 and 401 as a refused code, and rethrows anything else", async () => {
    verifyTOTP.mockRejectedValueOnce(new APIError("UNAUTHORIZED", { message: "Invalid code" }));
    await expect(
      factor.verify({ code: "000000", headers, method: "totp", sessionId: "s" }),
    ).resolves.toEqual({ ok: false });

    verifyTOTP.mockRejectedValueOnce(new APIError("BAD_REQUEST", { message: "Not enabled" }));
    await expect(
      factor.verify({ code: "000000", headers, method: "totp", sessionId: "s" }),
    ).resolves.toEqual({ ok: false });

    verifyTOTP.mockRejectedValueOnce(new APIError("CONFLICT", { message: "Retry" }));
    await expect(
      factor.verify({ code: "000000", headers, method: "totp", sessionId: "s" }),
    ).rejects.toThrow();

    verifyTOTP.mockRejectedValueOnce(new Error("database down"));
    await expect(
      factor.verify({ code: "000000", headers, method: "totp", sessionId: "s" }),
    ).rejects.toThrow("database down");
  });
});
