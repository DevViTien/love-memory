import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { RETENTION_ROWS } from "@/app/privacy/page";

import PrivacyPage from "../app/privacy/page";
import { SiteFooter } from "./site-footer";

describe("privacy notice", () => {
  afterEach(() => {
    cleanup();
  });

  it("links every page to /privacy (Footer on the recipient page)", () => {
    render(createElement(SiteFooter));

    expect(screen.getByRole("link", { name: "Quyền riêng tư" }).getAttribute("href")).toBe(
      "/privacy",
    );
  });

  it("states the retention of each kind of data (Notice reachable without an account)", () => {
    render(createElement(PrivacyPage));

    expect(screen.getByRole("heading", { name: "Chính sách quyền riêng tư" })).toBeTruthy();
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(RETENTION_ROWS.length + 1);
    const text = rows.map((row) => row.textContent).join("\n");
    expect(text).toContain("14 ngày với gói Miễn phí, 1 năm với gói Tiêu chuẩn");
    expect(text).toContain("Xoá trong vài phút sau khi cập nhật.");
    expect(text).toContain("xoá hẳn trong vòng 24 giờ");
    expect(screen.getByRole("heading", { name: "Cookie và bộ nhớ trình duyệt" })).toBeTruthy();
    expect(screen.getByText(/Không có cookie quảng cáo/)).toBeTruthy();
  });
});
