import type { Metadata } from "next";
import { headers } from "next/headers";

import { auditService, getAdminAccess } from "@/composition/admin";
import { requireAdminPage } from "@/modules/admin/presentation/admin-guard";
import { AdminAuditTable } from "@/modules/admin/presentation/admin-views";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Nhật ký quản trị",
};

/** The audit page lists this many records (`audit-log` "Audit page"). */
const AUDIT_PAGE_LIMIT = 100;

type AdminAuditPageProps = Readonly<{ searchParams: Promise<{ target?: string | string[] }> }>;

/** Reading the log is not itself recorded. */
export default async function AdminAuditPage({ searchParams }: AdminAuditPageProps) {
  requireAdminPage(await getAdminAccess(await headers()));
  const rawTarget = (await searchParams).target;
  const target = (Array.isArray(rawTarget) ? rawTarget[0] : rawTarget)?.trim().slice(0, 200);
  const records = await auditService.listLatest({
    limit: AUDIT_PAGE_LIMIT,
    ...(target ? { targetId: target } : {}),
  });

  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-black tracking-tight text-stone-900">Nhật ký quản trị</h1>
      {target ? (
        <p className="text-sm text-stone-600">
          Đối tượng: <span className="font-mono">{target}</span>
        </p>
      ) : null}
      <AdminAuditTable records={records} />
    </section>
  );
}
