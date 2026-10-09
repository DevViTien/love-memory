import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { type AbuseReport } from "../application/abuse-reports";
import { type ReportQueueItem } from "../application/moderation";
import { AdminReportQueue, availableActions, ReviewedGiftContent } from "./admin-report-views";
import { ReportActions } from "./report-actions";

const now = new Date("2026-10-10T03:00:00.000Z");
const report: AbuseReport = {
  category: "harassment",
  createdAt: now,
  details: "Lời lẽ xúc phạm",
  expiresAt: now,
  giftId: "gift-1",
  id: "report-1",
  severity: "normal",
  severityRank: 2,
  status: "open",
  updatedAt: now,
};
const live: ReportQueueItem["gift"] = {
  gone: false,
  id: "gift-1",
  publicId: "pub-1",
  status: "published",
  takenDown: false,
};

describe("admin report views", () => {
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

  it("offers only the actions that would change something", () => {
    expect(availableActions({ gift: live, report })).toEqual(["takedown", "dismiss"]);
    expect(availableActions({ gift: { ...live, takenDown: true }, report })).toEqual([
      "dismiss",
      "restore",
    ]);
    expect(
      availableActions({
        gift: { ...live, takenDown: true },
        report: { ...report, status: "actioned" },
      }),
    ).toEqual(["restore"]);
    expect(
      availableActions({ gift: { gone: true, id: "gift-1", publicId: null }, report }),
    ).toEqual(["dismiss"]);
    expect(
      availableActions({
        gift: { gone: true, id: "gift-1", publicId: null },
        report: { ...report, status: "dismissed" },
      }),
    ).toEqual([]);
  });

  it("lists each report with its gift, count, details and review link", () => {
    render(
      createElement(AdminReportQueue, {
        items: [
          { gift: { ...live, status: "paused", takenDown: true }, openReportsOnGift: 2, report },
        ],
      }),
    );

    const item = screen.getByRole("listitem");
    expect(item.textContent).toContain("Thường · Quấy rối hoặc lăng mạ");
    expect(item.textContent).toContain("10:00 10/10/2026");
    expect(item.textContent).toContain("pub-1 · paused · đã gỡ");
    expect(item.textContent).toContain("2 báo cáo đang mở");
    expect(item.textContent).toContain("Lời lẽ xúc phạm");
    expect(screen.getByRole("link", { name: "Xem nội dung" }).getAttribute("href")).toBe(
      "/admin/reports/report-1",
    );
  });

  it("says so when the queue is empty, and labels a deleted gift", () => {
    const { unmount } = render(createElement(AdminReportQueue, { items: [] }));
    expect(screen.getByText("Không có báo cáo nào đang chờ.")).toBeTruthy();
    unmount();

    render(
      createElement(AdminReportQueue, {
        items: [
          { gift: { gone: true, id: "gift-1", publicId: "pub-1" }, openReportsOnGift: 1, report },
        ],
      }),
    );
    expect(screen.getByRole("listitem").textContent).toContain("pub-1 · đã xoá");
  });

  it("sends a confirmed action and refreshes, and reports a failure", async () => {
    const user = userEvent.setup();
    render(
      createElement(ReportActions, {
        actions: ["takedown"],
        confirm: () => true,
        reportId: "report-1",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Gỡ món quà" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/reports/report-1",
      expect.objectContaining({ body: JSON.stringify({ action: "takedown" }), method: "POST" }),
    );
    expect(router.refresh).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 409 }));
    await user.click(screen.getByRole("button", { name: "Gỡ món quà" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Chưa thực hiện được. Vui lòng thử lại.",
    );
  });

  it("sends nothing when the confirmation is declined", async () => {
    const user = userEvent.setup();
    render(
      createElement(ReportActions, {
        actions: ["dismiss"],
        confirm: () => false,
        reportId: "report-1",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Bỏ qua" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders reviewed content as plain text and signed photos (Admin reviews reported content)", () => {
    render(
      createElement(ReviewedGiftContent, {
        blocks: [
          { fieldId: "receiver", kind: "text", multiline: false, text: "Minh Thư" },
          {
            fieldId: "memories",
            items: [
              {
                assetId: "a1",
                caption: "Đà Lạt",
                fallbackText: "Đà Lạt",
                index: 0,
                url: "https://blob.example/a1?sig=1",
              },
              { assetId: "a2", fallbackText: "Ảnh 2", index: 1 },
            ],
            kind: "images",
          },
        ],
      }),
    );

    const section = screen.getByRole("region", { name: "Nội dung bị báo cáo" });
    expect(section.textContent).toContain("Minh Thư");
    expect(screen.getByRole("img", { name: "Đà Lạt" }).getAttribute("src")).toBe(
      "https://blob.example/a1?sig=1",
    );
    expect(section.textContent).toContain("Ảnh 2");
  });

  it("says so when the gift has no content", () => {
    render(createElement(ReviewedGiftContent, { blocks: [] }));
    expect(screen.getByText("Món quà không có nội dung.")).toBeTruthy();
  });
});
