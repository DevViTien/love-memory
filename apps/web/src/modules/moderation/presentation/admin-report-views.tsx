import Link from "next/link";

import { formatAdminTime } from "@/modules/admin/presentation/admin-views";
import { type StaticGiftBlock } from "@/modules/viewer/presentation/static-gift-content";

import { type AbuseReport } from "../application/abuse-reports";
import { type ModerationAction, type ReportQueueItem } from "../application/moderation";
import { ReportActions } from "./report-actions";
import { REPORT_CATEGORY_LABELS } from "./report-labels";

const SEVERITY_LABELS: Readonly<Record<AbuseReport["severity"], string>> = {
  critical: "Khẩn cấp",
  high: "Cao",
  normal: "Thường",
};

/** The actions that would change something for this report and its gift. */
export function availableActions(
  item: Pick<ReportQueueItem, "gift" | "report">,
): ModerationAction[] {
  if (item.gift.gone) return item.report.status === "open" ? ["dismiss"] : [];
  const actions: ModerationAction[] = [];
  if (item.report.status === "open") {
    if (!item.gift.takenDown) actions.push("takedown");
    actions.push("dismiss");
  }
  if (item.gift.takenDown) actions.push("restore");
  return actions;
}

function giftLine(gift: ReportQueueItem["gift"]): string {
  if (gift.gone) return `${gift.publicId ?? gift.id} · đã xoá`;
  return `${gift.publicId} · ${gift.status}${gift.takenDown ? " · đã gỡ" : ""}`;
}

/** `/admin/reports`: open reports, critical first, newest first (`abuse-reports`). */
export function AdminReportQueue({ items }: Readonly<{ items: readonly ReportQueueItem[] }>) {
  if (items.length === 0) {
    return <p className="text-stone-600">Không có báo cáo nào đang chờ.</p>;
  }
  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <li
          className="rounded-2xl border border-stone-200 bg-white p-4"
          data-report-id={item.report.id}
          key={item.report.id}
        >
          <p className="font-bold text-stone-900">
            {SEVERITY_LABELS[item.report.severity]} · {REPORT_CATEGORY_LABELS[item.report.category]}{" "}
            <span className="font-mono text-xs text-stone-500">({item.report.category})</span>
          </p>
          <p className="mt-1 text-sm text-stone-600">
            {formatAdminTime(item.report.createdAt)} ·{" "}
            <span className="font-mono">{giftLine(item.gift)}</span> · {item.openReportsOnGift} báo
            cáo đang mở
          </p>
          {item.report.details ? (
            <p className="mt-2 text-sm whitespace-pre-line text-stone-800">{item.report.details}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link
              className="text-sm font-bold text-rose-700 underline"
              href={`/admin/reports/${encodeURIComponent(item.report.id)}`}
            >
              Xem nội dung
            </Link>
            <ReportActions actions={availableActions(item)} reportId={item.report.id} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The reported publication in the static rendering: plain text and signed photos only. */
export function ReviewedGiftContent({ blocks }: Readonly<{ blocks: readonly StaticGiftBlock[] }>) {
  if (blocks.length === 0) return <p className="text-stone-600">Món quà không có nội dung.</p>;
  return (
    <section
      aria-label="Nội dung bị báo cáo"
      className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5"
    >
      {blocks.map((block) =>
        block.kind === "text" ? (
          <p
            className={block.multiline ? "whitespace-pre-line text-stone-900" : "text-stone-900"}
            key={block.fieldId}
          >
            {block.text}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" key={block.fieldId}>
            {block.items.map((item) => (
              <figure key={item.assetId}>
                {item.url ? (
                  // Short-lived signed URLs from the review payload; never cached or optimized.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt={item.fallbackText} className="w-full rounded-xl" src={item.url} />
                ) : (
                  <p className="text-sm text-stone-500">{item.fallbackText}</p>
                )}
                {item.caption ? (
                  <figcaption className="mt-1 text-sm text-stone-700">{item.caption}</figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        ),
      )}
    </section>
  );
}
