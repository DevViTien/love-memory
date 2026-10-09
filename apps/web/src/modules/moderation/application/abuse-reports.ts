import { z } from "zod";

export const REPORT_CATEGORIES = [
  "child_safety",
  "self_harm",
  "violence",
  "sexual",
  "illegal",
  "harassment",
  "spam",
  "other",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export type ReportSeverity = "critical" | "high" | "normal";

/** `critical` reports take the gift down at once (`abuse-reports` "Emergency takedown"). */
export const REPORT_SEVERITY: Readonly<Record<ReportCategory, ReportSeverity>> = {
  child_safety: "critical",
  harassment: "normal",
  illegal: "high",
  other: "normal",
  self_harm: "critical",
  sexual: "high",
  spam: "normal",
  violence: "high",
};

/** The queue sorts by this rank, then newest first. */
export const SEVERITY_RANK: Readonly<Record<ReportSeverity, number>> = {
  critical: 0,
  high: 1,
  normal: 2,
};

export const REPORT_DETAILS_MAX_LENGTH = 1000;
export const REPORT_RETENTION_MILLISECONDS = 365 * 24 * 60 * 60 * 1000;

export const ReportRequestSchema = z
  .object({
    category: z.enum(REPORT_CATEGORIES),
    details: z.string().trim().max(REPORT_DETAILS_MAX_LENGTH).optional(),
    shareId: z.string().min(1).max(64),
  })
  .strict();

export type ReportRequest = z.output<typeof ReportRequestSchema>;

export type AbuseReport = Readonly<{
  category: ReportCategory;
  createdAt: Date;
  details: string | null;
  expiresAt: Date;
  giftId: string;
  id: string;
  severity: ReportSeverity;
  severityRank: number;
  status: "actioned" | "dismissed" | "open";
  updatedAt: Date;
}>;

export interface AbuseReportStore {
  /**
   * One transaction: the report, and for an emergency the system takedown of the gift with its
   * `gift.taken_down` record (only when the gift has no takedown yet).
   */
  insertReport(input: Readonly<{ emergency: boolean; report: AbuseReport }>): Promise<void>;
}

type Dependencies = Readonly<{
  clock?: () => Date;
  createId?: () => string;
  /** The internal id of the gift a share id opens right now, or `null` (`public-gift-viewer`). */
  findLiveGiftId: (shareId: string) => Promise<string | null>;
  /** Wakes the worker for the owner's takedown email after an emergency; never throws. */
  notifyOwner?: () => Promise<void>;
  reports: AbuseReportStore;
}>;

/** `POST /api/reports` (`abuse-reports` "Report endpoint"): the share id is never stored. */
export function createAbuseReportService({
  clock = () => new Date(),
  // The global Web Crypto API: this module is also bundled into the report form.
  createId = () => crypto.randomUUID(),
  findLiveGiftId,
  notifyOwner = () => Promise.resolve(),
  reports,
}: Dependencies) {
  return {
    async submit(request: ReportRequest): Promise<"not-found" | "received"> {
      const giftId = await findLiveGiftId(request.shareId);
      if (!giftId) return "not-found";
      const now = clock();
      const severity = REPORT_SEVERITY[request.category];
      await reports.insertReport({
        emergency: severity === "critical",
        report: {
          category: request.category,
          createdAt: now,
          details: request.details ? request.details : null,
          expiresAt: new Date(now.getTime() + REPORT_RETENTION_MILLISECONDS),
          giftId,
          id: createId(),
          severity,
          severityRank: SEVERITY_RANK[severity],
          status: "open",
          updatedAt: now,
        },
      });
      // An emergency takedown committed the owner's email with the report.
      if (severity === "critical") await notifyOwner();
      return "received";
    },
  } as const;
}

export type AbuseReportService = ReturnType<typeof createAbuseReportService>;
