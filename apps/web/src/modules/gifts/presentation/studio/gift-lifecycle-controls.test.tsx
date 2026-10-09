import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

import {
  DELETE_CONFIRMATION,
  DeleteGiftButton,
  LIFECYCLE_ERROR,
  PauseGiftButton,
  PausedGiftPanel,
} from "./gift-lifecycle-controls";

const publicId = "q1w2e3r4t5y6u7i8";

describe("gift lifecycle controls", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("pauses and lets the server render the paused panel (Pause from the published panel)", async () => {
    const user = userEvent.setup();
    render(createElement(PauseGiftButton, { publicId }));

    await user.click(screen.getByRole("button", { name: "Tạm dừng chia sẻ" }));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/gifts/${publicId}/pause`,
      expect.objectContaining({ body: "{}", method: "POST" }),
    );
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("deletes after the confirmation and leaves for /studio/deleted (Delete a draft from the Studio)", async () => {
    const confirm = vi.fn(() => true);
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 202 }));
    const user = userEvent.setup();
    render(createElement(DeleteGiftButton, { confirm, publicId }));

    await user.click(screen.getByRole("button", { name: "Xoá món quà" }));

    expect(confirm).toHaveBeenCalledWith(DELETE_CONFIRMATION);
    expect(DELETE_CONFIRMATION).toBe(
      "Xoá vĩnh viễn món quà này? Người nhận sẽ không mở được nữa, và ảnh cùng nội dung sẽ bị xoá hẳn trong vòng 24 giờ. Không thể hoàn tác.",
    );
    expect(fetchMock).toHaveBeenCalledWith(`/api/gifts/${publicId}/delete`, expect.anything());
    expect(router.replace).toHaveBeenCalledWith("/studio/deleted");
  });

  it("sends nothing when the confirmation is declined (Delete declined)", async () => {
    const user = userEvent.setup();
    render(createElement(DeleteGiftButton, { confirm: () => false, publicId }));

    await user.click(screen.getByRole("button", { name: "Xoá món quà" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the error and stays put when a request fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    const user = userEvent.setup();
    render(createElement(PauseGiftButton, { publicId }));

    await user.click(screen.getByRole("button", { name: "Tạm dừng chia sẻ" }));

    expect((await screen.findByRole("alert")).textContent).toBe(LIFECYCLE_ERROR);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("shows the paused panel with resume and delete (Paused gift in the Studio)", async () => {
    const user = userEvent.setup();
    render(
      createElement(PausedGiftPanel, {
        expired: false,
        expiresAt: "2026-10-22T10:00:00.000Z",
        publicId,
      }),
    );

    expect(screen.getByRole("heading", { name: "Đã tạm dừng chia sẻ" })).toBeTruthy();
    expect(
      screen.getByText(
        "Người nhận đang không mở được món quà. Đường dẫn cũ sẽ hoạt động lại khi bạn tiếp tục chia sẻ.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Xoá món quà" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Tiếp tục chia sẻ" }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/gifts/${publicId}/resume`, expect.anything());
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("offers no resume once the gift has expired", () => {
    render(
      createElement(PausedGiftPanel, {
        expired: true,
        expiresAt: "2026-10-01T10:00:00.000Z",
        publicId,
      }),
    );

    expect(screen.getByText("Món quà đã hết hạn nên không thể tiếp tục chia sẻ.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tiếp tục chia sẻ" })).toBeNull();
  });
});
