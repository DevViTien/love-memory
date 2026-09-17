import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthStatusLink } from "./auth-status-link";

const authClientMock = vi.hoisted(() => ({ useSession: vi.fn() }));

vi.mock("@/composition/auth-client", () => ({
  authClient: authClientMock,
}));

describe("AuthStatusLink", () => {
  beforeEach(() => {
    authClientMock.useSession.mockReset();
  });

  it("shows the sign-in action without a session", () => {
    authClientMock.useSession.mockReturnValue({ data: null });

    render(createElement(AuthStatusLink));

    expect(screen.getByRole("link", { name: "Đăng nhập" }).getAttribute("href")).toBe(
      "/auth/sign-in",
    );
  });

  it("shows the account action for an authenticated user", () => {
    authClientMock.useSession.mockReturnValue({
      data: { user: { email: "creator@example.com" } },
    });

    render(createElement(AuthStatusLink));

    expect(screen.getByRole("link", { name: "Tài khoản" }).getAttribute("href")).toBe(
      "/auth/sign-in",
    );
  });
});
