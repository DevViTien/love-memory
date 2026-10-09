import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { getAdminAccess } from "@/composition/admin";
import { moderationService } from "@/composition/moderation";
import { requireAdminPage } from "@/modules/admin/presentation/admin-guard";
import { formatAdminTime } from "@/modules/admin/presentation/admin-views";
import { ReviewedGiftContent } from "@/modules/moderation/presentation/admin-report-views";
import { ReportActions } from "@/modules/moderation/presentation/report-actions";
import { REPORT_CATEGORY_LABELS } from "@/modules/moderation/presentation/report-labels";
import { toStaticGiftBlocks } from "@/modules/viewer/presentation/static-gift-content";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Xem báo cáo",
};

type ReviewPageProps = Readonly<{ params: Promise<{ reportId: string }> }>;

/** The only place an admin sees gift content: audited before it is loaded (`abuse-reports`). */
export default async function AdminReportReviewPage({ params }: ReviewPageProps) {
  const requestHeaders = await headers();
  const session = requireAdminPage(await getAdminAccess(requestHeaders));
  const suppliedRequestId = requestHeaders.get("x-request-id");
  const result = await moderationService.review(
    (await params).reportId,
    session,
    suppliedRequestId && suppliedRequestId.length <= 128 ? suppliedRequestId : null,
  );
  if (result.kind === "not-found") notFound();
  const { content, report } = result;

  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-black tracking-tight text-stone-900">Xem báo cáo</h1>
      <div className="rounded-2xl border border-stone-200 bg-white p-4 text-sm">
        <p className="font-bold text-stone-900">{REPORT_CATEGORY_LABELS[report.category]}</p>
        <p className="mt-1 text-stone-600">
          {formatAdminTime(report.createdAt)} · {report.status} ·{" "}
          <span className="font-mono">{report.giftId}</span>
        </p>
        {report.details ? (
          <p className="mt-2 whitespace-pre-line text-stone-800">{report.details}</p>
        ) : null}
      </div>
      {content ? (
        <ReviewedGiftContent
          blocks={toStaticGiftBlocks(content.fields, content.payload, content.assets)}
        />
      ) : (
        <p className="text-stone-600">Không còn nội dung để xem.</p>
      )}
      <ReportActions
        actions={report.status === "open" ? ["takedown", "dismiss", "restore"] : ["restore"]}
        reportId={report.id}
      />
    </section>
  );
}
