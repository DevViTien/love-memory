import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MagicLinkForm } from "./magic-link-form";

const authClientMock = vi.hoisted(() => ({ signIn: { magicLink: vi.fn() } }));

vi.mock("@/composition/auth-client", () => ({
  authClient: authClientMock,
}));

describe("MagicLinkForm", () => {
  beforeEach(() => {
    authClientMock.signIn.magicLink.mockReset();
  });

  it("asks to open the link in the same browser and device (Confirmation does not depend on account existence)", async () => {
    authClientMock.signIn.magicLink.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(createElement(MagicLinkForm, { callbackUrl: "/studio/abc" }));

    await user.type(screen.getByLabelText("Email của bạn"), "creator@example.com");
    await user.click(screen.getByRole("button", { name: "Gửi liên kết đăng nhập" }));

    expect(await screen.findByText("Kiểm tra hộp thư của bạn")).toBeTruthy();
    expect(
      screen.getByText(
        "Hãy mở liên kết trên cùng trình duyệt và thiết bị này để tiếp tục bản nháp của bạn.",
      ),
    ).toBeTruthy();
    expect(authClientMock.signIn.magicLink).toHaveBeenCalledWith(
      expect.objectContaining({ callbackURL: "/studio/abc", newUserCallbackURL: "/studio/abc" }),
    );
  });

  it("recovers after a failed request (Delivery or transport failure is recoverable)", async () => {
    authClientMock.signIn.magicLink.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(createElement(MagicLinkForm));

    await user.type(screen.getByLabelText("Email của bạn"), "creator@example.com");
    await user.click(screen.getByRole("button", { name: "Gửi liên kết đăng nhập" }));

    expect(await screen.findByText(/Chưa thể gửi email lúc này/)).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Gửi liên kết đăng nhập" }).disabled,
    ).toBe(false);
  });
});
