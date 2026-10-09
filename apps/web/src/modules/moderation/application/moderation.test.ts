import { beforeEach, describe, expect, it, vi } from "vitest";

import { type AdminSession } from "@/modules/admin/application/admin-access";

import { type AbuseReport } from "./abuse-reports";
import { createModerationService, type ModerationRepository } from "./moderation";

const now = new Date("2026-10-10T10:00:00.000Z");
const session: AdminSession = {
  sessionId: "s-1",
  user: { email: "admin@example.test", id: "admin-1", role: "admin", twoFactorEnabled: true },
};

function report(overrides: Partial<AbuseReport> = {}): AbuseReport {
  return {
    category: "harassment",
    createdAt: now,
    details: null,
    expiresAt: now,
    giftId: "gift-1",
    id: "report-1",
    severity: "normal",
    severityRank: 2,
    status: "open",
    updatedAt: now,
    ...overrides,
  };
}

describe("moderation", () => {
  const repository = {
    countOpenByGift: vi.fn<ModerationRepository["countOpenByGift"]>(),
    dismiss: vi.fn<ModerationRepository["dismiss"]>(),
    findGiftStates: vi.fn<ModerationRepository["findGiftStates"]>(),
    findReport: vi.fn<ModerationRepository["findReport"]>(),
    listOpen: vi.fn<ModerationRepository["listOpen"]>(),
    restore: vi.fn<ModerationRepository["restore"]>(),
    takeDown: vi.fn<ModerationRepository["takeDown"]>(),
  };
  const record = vi.fn();
  const loadContent = vi.fn();
  const service = createModerationService({
    audit: { record },
    clock: () => now,
    loadContent,
    repository,
  });
  const actor = { id: "admin-1", requestId: "r-1" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists open reports with their gift and the open count, a gone gift included", async () => {
    repository.listOpen.mockResolvedValueOnce([
      report({ id: "r-a" }),
      report({ giftId: "gift-2", id: "r-b" }),
    ]);
    repository.findGiftStates.mockResolvedValueOnce(
      new Map([
        [
          "gift-1",
          { gone: false, id: "gift-1", publicId: "pub-1", status: "paused", takenDown: true },
        ],
      ]),
    );
    repository.countOpenByGift.mockResolvedValueOnce(new Map([["gift-1", 2]]));

    const queue = await service.listQueue();

    expect(repository.listOpen).toHaveBeenCalledWith(100);
    expect(repository.findGiftStates).toHaveBeenCalledWith(["gift-1", "gift-2"]);
    expect(queue[0]).toMatchObject({ gift: { takenDown: true }, openReportsOnGift: 2 });
    expect(queue[1]).toMatchObject({ gift: { gone: true, id: "gift-2" }, openReportsOnGift: 1 });
  });

  it("takes down, dismisses and restores (Admin takes a reported gift down)", async () => {
    repository.findReport.mockResolvedValue(report());
    repository.takeDown.mockResolvedValueOnce("done");
    await expect(service.act("report-1", "takedown", actor)).resolves.toEqual({
      kind: "ok",
      reportStatus: "actioned",
    });
    expect(repository.takeDown).toHaveBeenCalledWith({
      actorId: "admin-1",
      now,
      report: report(),
      requestId: "r-1",
    });

    await expect(service.act("report-1", "dismiss", actor)).resolves.toEqual({
      kind: "ok",
      reportStatus: "dismissed",
    });

    repository.restore.mockResolvedValueOnce("done");
    await expect(service.act("report-1", "restore", actor)).resolves.toEqual({
      kind: "ok",
      reportStatus: "dismissed",
    });
  });

  it("refuses unknown and closed reports, gone gifts and restores without a takedown", async () => {
    repository.findReport.mockResolvedValueOnce(null);
    await expect(service.act("x", "dismiss", actor)).resolves.toEqual({ kind: "not-found" });

    repository.findReport.mockResolvedValueOnce(report({ status: "actioned" }));
    await expect(service.act("report-1", "takedown", actor)).resolves.toEqual({
      kind: "report-closed",
    });

    repository.findReport.mockResolvedValueOnce(report({ status: "actioned" }));
    repository.restore.mockResolvedValueOnce("not-taken-down");
    await expect(service.act("report-1", "restore", actor)).resolves.toEqual({
      kind: "not-taken-down",
    });

    repository.findReport.mockResolvedValueOnce(report());
    repository.takeDown.mockResolvedValueOnce("gift-gone");
    await expect(service.act("report-1", "takedown", actor)).resolves.toEqual({
      kind: "gift-gone",
    });

    repository.findReport.mockResolvedValueOnce(report());
    repository.restore.mockResolvedValueOnce("gift-gone");
    await expect(service.act("report-1", "restore", actor)).resolves.toEqual({
      kind: "gift-gone",
    });
  });

  it("records the content view before loading anything (Admin reviews reported content)", async () => {
    repository.findReport.mockResolvedValueOnce(report());
    const order: string[] = [];
    record.mockImplementationOnce(() => {
      order.push("audit");
      return Promise.resolve();
    });
    loadContent.mockImplementationOnce(() => {
      order.push("load");
      return Promise.resolve(null);
    });

    await expect(service.review("report-1", session, "r-1")).resolves.toEqual({
      content: null,
      kind: "ok",
      report: report(),
    });
    expect(order).toEqual(["audit", "load"]);
    expect(record).toHaveBeenCalledWith(
      {
        action: "admin.gift.content_viewed",
        actor: { id: "admin-1", kind: "admin" },
        metadata: { reportId: "report-1" },
        target: { id: "gift-1", kind: "gift" },
      },
      "r-1",
    );
  });

  it("shows nothing when the audit write fails, and nothing for an unknown report", async () => {
    repository.findReport.mockResolvedValueOnce(report());
    record.mockRejectedValueOnce(new Error("audit down"));
    await expect(service.review("report-1", session, null)).rejects.toThrow("audit down");
    expect(loadContent).not.toHaveBeenCalled();

    repository.findReport.mockResolvedValueOnce(null);
    await expect(service.review("x", session, null)).resolves.toEqual({ kind: "not-found" });
  });
});
