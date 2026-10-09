import type { Metadata } from "next";
import { headers } from "next/headers";

import { getAdminAccess } from "@/composition/admin";
import { moderationService } from "@/composition/moderation";
import { requireAdminPage } from "@/modules/admin/presentation/admin-guard";
import { AdminReportQueue } from "@/modules/moderation/presentation/admin-report-views";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Báo cáo",
};

/** Viewing the queue is not recorded; each action is (`abuse-reports`). */
export default async function AdminReportsPage() {
  requireAdminPage(await getAdminAccess(await headers()));
  const items = await moderationService.listQueue();

  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-black tracking-tight text-stone-900">Báo cáo</h1>
      <AdminReportQueue items={items} />
    </section>
  );
}
