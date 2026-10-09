import { z } from "zod";

import { type AdminSession } from "@/modules/admin/application/admin-access";
import { type AuditService } from "@/modules/admin/application/audit";
import { type ViewerPayload } from "@/modules/viewer/application/viewer-payload";

import { type AbuseReport } from "./abuse-reports";

export const ModerationActionRequestSchema = z
  .object({ action: z.enum(["takedown", "dismiss", "restore"]) })
  .strict();

export type ModerationAction = z.output<typeof ModerationActionRequestSchema>["action"];

/** The queue's view of a reported gift: identifiers and state, never content. */
export type ReportedGiftState =
  | Readonly<{ gone: false; id: string; publicId: string; status: string; takenDown: boolean }>
  | Readonly<{ gone: true; id: string; publicId: string | null }>;

export type ReportQueueItem = Readonly<{
  gift: ReportedGiftState;
  openReportsOnGift: number;
  report: AbuseReport;
}>;

export type ModerationWriteInput = Readonly<{
  actorId: string;
  now: Date;
  report: AbuseReport;
  requestId: string;
}>;

export interface ModerationRepository {
  countOpenByGift(giftIds: readonly string[]): Promise<ReadonlyMap<string, number>>;
  /** One transaction: the report closed as `dismissed`, and `admin.report.dismissed`. */
  dismiss(input: ModerationWriteInput): Promise<void>;
  findGiftStates(giftIds: readonly string[]): Promise<ReadonlyMap<string, ReportedGiftState>>;
  findReport(reportId: string): Promise<AbuseReport | null>;
  listOpen(limit: number): Promise<readonly AbuseReport[]>;
  /**
   * One transaction: the takedown lifted, the gift's open reports closed as `dismissed`, and
   * `admin.gift.restored`. `gift-gone` and `not-taken-down` change nothing.
   */
  restore(input: ModerationWriteInput): Promise<"done" | "gift-gone" | "not-taken-down">;
  /**
   * One transaction: the takedown by `admin` (unless one exists), the gift's open reports closed as
   * `actioned`, and `admin.gift.taken_down`. `gift-gone` changes nothing.
   */
  takeDown(input: ModerationWriteInput): Promise<"done" | "gift-gone">;
}

export type ModerationActionResult =
  | Readonly<{ kind: "gift-gone" }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "not-taken-down" }>
  | Readonly<{ kind: "ok"; reportStatus: AbuseReport["status"] }>
  | Readonly<{ kind: "report-closed" }>;

export type ReviewResult =
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ content: ViewerPayload | null; kind: "ok"; report: AbuseReport }>;

type Dependencies = Readonly<{
  audit: Pick<AuditService, "record">;
  clock?: () => Date;
  /** The reported gift's current publication as a viewer payload (signed photos), or `null`. */
  loadContent: (giftId: string) => Promise<ViewerPayload | null>;
  /** Wakes the worker for the owner's takedown email; never throws. */
  notifyOwner?: () => Promise<void>;
  repository: ModerationRepository;
}>;

export const REPORT_QUEUE_LIMIT = 100;

/** The admin side of `abuse-reports`: the queue, the actions and the audited content review. */
export function createModerationService({
  audit,
  clock = () => new Date(),
  loadContent,
  notifyOwner = () => Promise.resolve(),
  repository,
}: Dependencies) {
  async function listQueue(): Promise<readonly ReportQueueItem[]> {
    const reports = await repository.listOpen(REPORT_QUEUE_LIMIT);
    const giftIds = [...new Set(reports.map((report) => report.giftId))];
    const [states, counts] = await Promise.all([
      repository.findGiftStates(giftIds),
      repository.countOpenByGift(giftIds),
    ]);
    return reports.map((report) => ({
      gift: states.get(report.giftId) ?? { gone: true, id: report.giftId, publicId: null },
      openReportsOnGift: counts.get(report.giftId) ?? 1,
      report,
    }));
  }

  async function act(
    reportId: string,
    action: ModerationAction,
    actor: Readonly<{ id: string; requestId: string }>,
  ): Promise<ModerationActionResult> {
    const report = await repository.findReport(reportId);
    if (!report) return { kind: "not-found" };
    if (report.status !== "open" && action !== "restore") return { kind: "report-closed" };
    const input = { actorId: actor.id, now: clock(), report, requestId: actor.requestId };

    if (action === "dismiss") {
      await repository.dismiss(input);
      return { kind: "ok", reportStatus: "dismissed" };
    }
    if (action === "takedown") {
      const outcome = await repository.takeDown(input);
      if (outcome !== "done") return { kind: "gift-gone" };
      await notifyOwner();
      return { kind: "ok", reportStatus: "actioned" };
    }
    const outcome = await repository.restore(input);
    if (outcome === "gift-gone") return { kind: "gift-gone" };
    if (outcome === "not-taken-down") return { kind: "not-taken-down" };
    return { kind: "ok", reportStatus: report.status === "open" ? "dismissed" : report.status };
  }

  /** Audited before anything is loaded: a failed write shows nothing (`abuse-reports`). */
  async function review(
    reportId: string,
    session: AdminSession,
    requestId: string | null,
  ): Promise<ReviewResult> {
    const report = await repository.findReport(reportId);
    if (!report) return { kind: "not-found" };
    await audit.record(
      {
        action: "admin.gift.content_viewed",
        actor: { id: session.user.id, kind: "admin" },
        metadata: { reportId },
        target: { id: report.giftId, kind: "gift" },
      },
      requestId,
    );
    return { content: await loadContent(report.giftId), kind: "ok", report };
  }

  return { act, listQueue, review } as const;
}

export type ModerationService = ReturnType<typeof createModerationService>;
