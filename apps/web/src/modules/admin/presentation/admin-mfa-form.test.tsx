import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { ADMIN_MFA_BACKUP_NOTE, AdminMfaForm } from "./admin-mfa-form";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("AdminMfaForm", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the setup key, the URI and the backup codes once, then the code form (First enrollment)", async () => {
    const onVerified = vi.fn();
    fetchMock
      .mockResolvedValueOnce(
        json(201, {
          data: {
            backupCodes: ["aaaa-1111", "bbbb-2222"],
            setupKey: "JBSWY3DPEHPK3PXP",
            totpUri: "otpauth://totp/LoveMemory:a?secret=JBSWY3DPEHPK3PXP",
          },
        }),
      )
      .mockResolvedValueOnce(json(200, { data: { verified: true } }));
    const user = userEvent.setup();
    render(createElement(AdminMfaForm, { enrolled: false, onVerified }));

    expect(screen.queryByLabelText("Mã xác thực")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Tạo mã thiết lập" }));

    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeTruthy();
    expect(screen.getByText("otpauth://totp/LoveMemory:a?secret=JBSWY3DPEHPK3PXP")).toBeTruthy();
    expect(screen.getByText("aaaa-1111")).toBeTruthy();
    expect(screen.getByText(ADMIN_MFA_BACKUP_NOTE)).toBeTruthy();
    expect(ADMIN_MFA_BACKUP_NOTE).toBe(
      "Lưu các mã dự phòng ở nơi an toàn. Mỗi mã chỉ dùng được một lần.",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/mfa/enroll",
      expect.objectContaining({ body: "{}", method: "POST" }),
    );

    await user.type(screen.getByLabelText("Mã xác thực"), "123456");
    await user.click(screen.getByRole("button", { name: "Xác nhận" }));

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/admin/mfa/verify",
      expect.objectContaining({ body: JSON.stringify({ code: "123456" }) }),
    );
    expect(onVerified).toHaveBeenCalledTimes(1);
  });

  it("shows only the code form to an enrolled admin, and a wrong-code message (Wrong code)", async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: { code: "VALIDATION_ERROR" } }));
    const user = userEvent.setup();
    render(createElement(AdminMfaForm, { enrolled: true, onVerified: vi.fn() }));

    expect(screen.queryByRole("button", { name: "Tạo mã thiết lập" })).toBeNull();
    await user.type(screen.getByLabelText("Mã xác thực"), "000000");
    await user.click(screen.getByRole("button", { name: "Xác nhận" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Mã không đúng. Vui lòng thử lại.");
  });

  it("goes to /admin after a valid code by default", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: { verified: true } }));
    const user = userEvent.setup();
    render(createElement(AdminMfaForm, { enrolled: true }));

    await user.type(screen.getByLabelText("Mã xác thực"), "123456");
    await user.click(screen.getByRole("button", { name: "Xác nhận" }));

    expect(router.replace).toHaveBeenCalledWith("/admin");
  });

  it("tells the admin how long to wait after too many attempts", async () => {
    fetchMock.mockResolvedValueOnce(
      json(429, { error: { code: "RATE_LIMITED", details: { retryAfterSeconds: 610 } } }),
    );
    const user = userEvent.setup();
    render(createElement(AdminMfaForm, { enrolled: true, onVerified: vi.fn() }));

    await user.type(screen.getByLabelText("Mã xác thực"), "123456");
    await user.click(screen.getByRole("button", { name: "Xác nhận" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau 11 phút.",
    );
  });

  it("recovers from transport and server failures", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json(500, { error: { code: "INTERNAL_ERROR" } }));
    const user = userEvent.setup();
    render(createElement(AdminMfaForm, { enrolled: true, onVerified: vi.fn() }));

    await user.type(screen.getByLabelText("Mã xác thực"), "123456");
    await user.click(screen.getByRole("button", { name: "Xác nhận" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Chưa thể xác thực lúc này. Vui lòng thử lại.",
    );

    await user.click(screen.getByRole("button", { name: "Xác nhận" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Chưa thể xác thực lúc này. Vui lòng thử lại.",
    );
  });

  it("falls back to the code form when a factor was enabled meanwhile, and reports a failed setup", async () => {
    fetchMock
      .mockResolvedValueOnce(json(500, { error: { code: "INTERNAL_ERROR" } }))
      .mockResolvedValueOnce(json(409, { error: { code: "CONFLICT" } }));
    const user = userEvent.setup();
    render(createElement(AdminMfaForm, { enrolled: false, onVerified: vi.fn() }));

    await user.click(screen.getByRole("button", { name: "Tạo mã thiết lập" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Chưa thể tạo mã thiết lập. Vui lòng thử lại.",
    );

    await user.click(screen.getByRole("button", { name: "Tạo mã thiết lập" }));
    expect(await screen.findByLabelText("Mã xác thực")).toBeTruthy();
  });
});
