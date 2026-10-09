import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AbuseReportStore,
  createAbuseReportService,
  REPORT_CATEGORIES,
  REPORT_SEVERITY,
  ReportRequestSchema,
} from "./abuse-reports";

const now = new Date("2026-10-10T10:00:00.000Z");
const giftId = "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89";
const shareId = "Ab0_-cdefghijklmnopqrs";

describe("abuse reports", () => {
  const insertReport = vi.fn<AbuseReportStore["insertReport"]>();
  const findLiveGiftId = vi.fn<(shareId: string) => Promise<string | null>>();
  const service = createAbuseReportService({
    clock: () => now,
    createId: () => "report-1",
    findLiveGiftId,
    reports: { insertReport },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    findLiveGiftId.mockResolvedValue(giftId);
  });

  it("assigns each category its severity", () => {
    expect(REPORT_CATEGORIES.map((category) => [category, REPORT_SEVERITY[category]])).toEqual([
      ["child_safety", "critical"],
      ["self_harm", "critical"],
      ["violence", "high"],
      ["sexual", "high"],
      ["illegal", "high"],
      ["harassment", "normal"],
      ["spam", "normal"],
      ["other", "normal"],
    ]);
  });

  it("stores the gift's internal id and never the share id (Report stored without the share id)", async () => {
    await expect(
      service.submit({ category: "harassment", details: "Ảnh xúc phạm", shareId }),
    ).resolves.toBe("received");

    expect(insertReport).toHaveBeenCalledWith({
      emergency: false,
      report: {
        category: "harassment",
        createdAt: now,
        details: "Ảnh xúc phạm",
        expiresAt: new Date("2027-10-10T10:00:00.000Z"),
        giftId,
        id: "report-1",
        severity: "normal",
        severityRank: 2,
        status: "open",
        updatedAt: now,
      },
    });
    expect(JSON.stringify(insertReport.mock.calls)).not.toContain(shareId);
  });

  it("asks for an emergency takedown for a critical report (Critical report pauses the gift at once)", async () => {
    await service.submit({ category: "child_safety", shareId });

    expect(insertReport).toHaveBeenCalledWith({
      emergency: true,
      report: expect.objectContaining({
        details: null,
        severity: "critical",
        severityRank: 0,
      }) as unknown,
    });
  });

  it("stores nothing for a link that does not open (Report for a link that does not open)", async () => {
    findLiveGiftId.mockResolvedValueOnce(null);

    await expect(service.submit({ category: "spam", shareId })).resolves.toBe("not-found");
    expect(insertReport).not.toHaveBeenCalled();
  });

  it("uses the server clock and a fresh UUID by default", async () => {
    const insert = vi.fn<AbuseReportStore["insertReport"]>();
    const defaults = createAbuseReportService({
      findLiveGiftId: () => Promise.resolve(giftId),
      reports: { insertReport: insert },
    });

    await defaults.submit({ category: "other", shareId });

    const stored = insert.mock.calls[0]?.[0].report;
    expect(stored?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored?.createdAt).toBeInstanceOf(Date);
  });

  it("validates the request strictly", () => {
    expect(ReportRequestSchema.safeParse({ category: "rude", shareId }).success).toBe(false);
    expect(
      ReportRequestSchema.safeParse({ category: "spam", details: "x".repeat(1001), shareId })
        .success,
    ).toBe(false);
    expect(
      ReportRequestSchema.safeParse({ category: "spam", email: "a@b.c", shareId }).success,
    ).toBe(false);
    expect(ReportRequestSchema.safeParse({ category: "spam", shareId }).success).toBe(true);
  });
});
