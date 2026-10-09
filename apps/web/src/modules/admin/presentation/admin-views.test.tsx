import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { buildAuditRecord } from "../application/audit";
import { type AdminGiftSummary } from "../application/gift-lookup";
import {
  AdminAuditTable,
  AdminGiftSummaryView,
  AdminGiftTombstoneView,
  formatAdminTime,
} from "./admin-views";

const gift: AdminGiftSummary = {
  assetCounts: { failed: 1, ready: 2 },
  createdAt: new Date("2026-10-01T01:05:00.000Z"),
  expiresAt: new Date("2026-10-31T17:30:00.000Z"),
  id: "8a0c1c1e-1111-4111-8111-111111111111",
  owner: { email: "owner@example.test", id: "user-1", kind: "user" },
  planId: "free",
  publicId: "abcDEF123456",
  publishedAt: null,
  publishedRevision: null,
  revision: 2,
  status: "published",
  templateId: "memory-box",
  templateVersion: "1.0.0",
  updatedAt: new Date("2026-10-02T00:00:00.000Z"),
};

describe("admin views", () => {
  afterEach(() => {
    cleanup();
  });

  it("formats times as HH:mm dd/MM/yyyy in Vietnam time", () => {
    expect(formatAdminTime(new Date("2026-10-31T17:30:00.000Z"))).toBe("00:30 01/11/2026");
    expect(formatAdminTime(null)).toBe("—");
  });

  it("shows the summary fields and links to the gift's records (Lookup by public id)", () => {
    render(createElement(AdminGiftSummaryView, { gift }));

    expect(screen.getByText(gift.id)).toBeTruthy();
    expect(screen.getByText("abcDEF123456")).toBeTruthy();
    expect(screen.getByText("memory-box@1.0.0")).toBeTruthy();
    expect(screen.getByText("00:30 01/11/2026")).toBeTruthy();
    expect(screen.getByText("owner@example.test (user-1)")).toBeTruthy();
    expect(screen.getByText("failed: 1, ready: 2")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Nhật ký của món quà này" }).getAttribute("href")).toBe(
      `/admin/audit?target=${gift.id}`,
    );
  });

  it("shows a deleted gift's ids and times only (Lookup of a deleted gift)", () => {
    render(
      createElement(AdminGiftTombstoneView, {
        tombstone: {
          createdAt: new Date("2026-10-01T01:05:00.000Z"),
          deletedAt: new Date("2026-10-10T05:00:00.000Z"),
          deletionRequestedAt: new Date("2026-10-10T04:00:00.000Z"),
          id: gift.id,
          ownerId: null,
          publicId: "abcDEF123456",
          publishedAt: null,
        },
      }),
    );

    const section = screen.getByRole("region", { name: "Món quà đã xoá" });
    expect(section.textContent).toContain("Đã xoá");
    expect(section.textContent).toContain("12:00 10/10/2026");
    expect(section.textContent).toContain("Bản nháp ẩn danh");
    expect(section.textContent).not.toContain("memory-box");
  });

  it("labels an anonymous draft", () => {
    render(
      createElement(AdminGiftSummaryView, { gift: { ...gift, owner: { kind: "anonymous" } } }),
    );

    expect(screen.getByText("Bản nháp ẩn danh")).toBeTruthy();
  });

  it("lists records with time, actor, action, target and metadata (Latest records)", () => {
    const records = [
      buildAuditRecord(
        {
          action: "admin.gift.looked_up",
          actor: { id: "admin-1", kind: "admin" },
          metadata: { matched: true },
          target: { id: gift.id, kind: "gift" },
        },
        "r-1",
        new Date("2026-10-09T03:04:00.000Z"),
        () => "audit-1",
      ),
      buildAuditRecord(
        {
          action: "admin.role.granted",
          actor: { id: "lan", kind: "operator" },
          target: null,
        },
        null,
        new Date("2026-10-08T03:04:00.000Z"),
        () => "audit-2",
      ),
    ];

    render(createElement(AdminAuditTable, { records }));

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]?.textContent).toContain("10:04 09/10/2026");
    expect(rows[1]?.textContent).toContain("admin:admin-1");
    expect(rows[1]?.textContent).toContain(`gift:${gift.id}`);
    expect(rows[1]?.textContent).toContain("matched=true");
    expect(rows[2]?.textContent).toContain("operator:lan");
  });

  it("says so when there is no record", () => {
    render(createElement(AdminAuditTable, { records: [] }));

    expect(screen.getByText("Chưa có bản ghi nào.")).toBeTruthy();
  });
});
