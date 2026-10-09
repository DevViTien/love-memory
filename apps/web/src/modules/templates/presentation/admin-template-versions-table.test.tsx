import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

import {
  type AdminTemplateVersionRow,
  AdminTemplateVersionsTable,
} from "./admin-template-versions-table";
import { TemplateVersionActions } from "./template-version-actions";

const published: AdminTemplateVersionRow = {
  current: true,
  hasArtifact: true,
  killReason: null,
  killed: false,
  status: "published",
  templateId: "memory-box",
  version: "1.1.0",
};

function json(status: number): Response {
  return new Response(JSON.stringify({}), { status });
}

describe("admin template versions", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows each version's state and only the actions that would change it", () => {
    render(
      createElement(AdminTemplateVersionsTable, {
        versions: [
          published,
          {
            ...published,
            current: false,
            hasArtifact: false,
            status: "retired",
            version: "1.0.0",
          },
          {
            ...published,
            current: false,
            killReason: "security",
            killed: true,
            status: "retired",
            templateId: "our-timeline",
            version: "1.0.0",
          },
        ],
      }),
    );

    const rows = screen.getAllByRole("row");
    expect(rows[1]?.textContent).toContain("memory-box@1.1.0");
    expect(rows[1]?.textContent).toContain("Phiên bản hiện tại");
    expect(rows[1]?.textContent).toContain("Có");
    expect(rows[1]?.textContent).toContain("Ngừng phát hành");
    expect(rows[1]?.textContent).toContain("Tắt khẩn cấp");
    expect(rows[2]?.textContent).toContain("Chưa có");
    expect(rows[2]?.textContent).not.toContain("Ngừng phát hành");
    expect(rows[3]?.textContent).toContain("Đã tắt (security)");
    expect(rows[3]?.textContent).toContain("Khôi phục");
    expect(rows[3]?.textContent).not.toContain("Tắt khẩn cấp");
  });

  it("says so when no version is stored", () => {
    render(createElement(AdminTemplateVersionsTable, { versions: [] }));

    expect(screen.getByText("Chưa có phiên bản mẫu nào.")).toBeTruthy();
  });

  it("kills with the chosen reason after confirmation and refreshes (Admin kills a version from the page)", async () => {
    fetchMock.mockResolvedValueOnce(json(200));
    const confirm = vi.fn(() => true);
    const user = userEvent.setup();
    render(
      createElement(TemplateVersionActions, {
        confirm,
        killed: false,
        status: "published",
        templateId: "memory-box",
        version: "1.1.0",
      }),
    );

    await user.selectOptions(screen.getByLabelText("Lý do tắt"), "security");
    await user.click(screen.getByRole("button", { name: "Tắt khẩn cấp" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Tắt khẩn cấp"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/template-versions",
      expect.objectContaining({
        body: JSON.stringify({
          action: "kill",
          reason: "security",
          templateId: "memory-box",
          version: "1.1.0",
        }),
        method: "POST",
      }),
    );
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the confirmation is declined", async () => {
    const user = userEvent.setup();
    render(
      createElement(TemplateVersionActions, {
        confirm: () => false,
        killed: false,
        status: "published",
        templateId: "memory-box",
        version: "1.1.0",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Ngừng phát hành" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("restores a killed version, and reports a failed request", async () => {
    fetchMock.mockResolvedValueOnce(json(500));
    const user = userEvent.setup();
    render(
      createElement(TemplateVersionActions, {
        confirm: () => true,
        killed: true,
        status: "retired",
        templateId: "memory-box",
        version: "1.1.0",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Khôi phục" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/template-versions",
      expect.objectContaining({
        body: JSON.stringify({ action: "restore", templateId: "memory-box", version: "1.1.0" }),
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Chưa thực hiện được. Vui lòng thử lại.",
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("offers nothing for a draft version", () => {
    const { container } = render(
      createElement(TemplateVersionActions, {
        killed: false,
        status: "draft",
        templateId: "memory-box",
        version: "2.0.0",
      }),
    );

    expect(container.textContent).toBe("");
  });
});
