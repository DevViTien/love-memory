import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REPORT_ERROR, REPORT_THANKS, ReportGiftForm } from "./report-gift-form";

const shareId = "Ab0_-cdefghijklmnopqrs";

describe("ReportGiftForm", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sends the category, the details and the share id, then thanks (Recipient reports a gift)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 202 }));
    const user = userEvent.setup();
    render(createElement(ReportGiftForm, { shareId }));

    await user.click(screen.getByRole("button", { name: "Báo cáo nội dung" }));
    expect(screen.getAllByRole("radio")).toHaveLength(8);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Gửi báo cáo" }).disabled).toBe(
      true,
    );
    await user.click(screen.getByLabelText("Quấy rối hoặc lăng mạ"));
    await user.type(screen.getByLabelText("Mô tả thêm (không bắt buộc)"), "  Lời lẽ xúc phạm  ");
    await user.click(screen.getByRole("button", { name: "Gửi báo cáo" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reports",
      expect.objectContaining({
        body: JSON.stringify({ category: "harassment", details: "Lời lẽ xúc phạm", shareId }),
        credentials: "omit",
        method: "POST",
      }),
    );
    expect((await screen.findByRole("status")).textContent).toBe(REPORT_THANKS);
  });

  it("keeps the form and the choice after a failure (Report request fails)", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockRejectedValueOnce(new TypeError("offline"));
    const user = userEvent.setup();
    render(createElement(ReportGiftForm, { shareId }));

    await user.click(screen.getByRole("button", { name: "Báo cáo nội dung" }));
    await user.click(screen.getByLabelText("Lừa đảo hoặc spam"));
    await user.click(screen.getByRole("button", { name: "Gửi báo cáo" }));

    expect((await screen.findByRole("alert")).textContent).toBe(REPORT_ERROR);
    expect(screen.getByLabelText<HTMLInputElement>("Lừa đảo hoặc spam").checked).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reports",
      expect.objectContaining({ body: JSON.stringify({ category: "spam", shareId }) }),
    );

    await user.click(screen.getByRole("button", { name: "Gửi báo cáo" }));
    expect((await screen.findByRole("alert")).textContent).toBe(REPORT_ERROR);
  });

  it("limits the details to 1000 characters", async () => {
    const user = userEvent.setup();
    render(createElement(ReportGiftForm, { shareId }));

    await user.click(screen.getByRole("button", { name: "Báo cáo nội dung" }));

    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Mô tả thêm (không bắt buộc)").maxLength,
    ).toBe(1000);
  });
});
