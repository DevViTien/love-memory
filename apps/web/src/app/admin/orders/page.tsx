import { Button } from "@love-memory/ui";
import type { Metadata } from "next";
import { headers } from "next/headers";

import { getAdminAccess, orderLookupService } from "@/composition/admin";
import { requireAdminPage } from "@/modules/admin/presentation/admin-guard";
import {
  ADMIN_ORDER_NOT_FOUND,
  AdminOrdersView,
} from "@/modules/billing/presentation/admin-order-views";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Đơn hàng",
};

type AdminOrdersPageProps = Readonly<{ searchParams: Promise<{ q?: string | string[] }> }>;

export default async function AdminOrdersPage({ searchParams }: AdminOrdersPageProps) {
  const requestHeaders = await headers();
  const session = requireAdminPage(await getAdminAccess(requestHeaders));
  const rawQuery = (await searchParams).q;
  const query = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery) ?? "";
  const suppliedRequestId = requestHeaders.get("x-request-id");
  // Audited before anything is rendered; a failed audit write fails the page.
  const result = await orderLookupService.lookup({
    query,
    requestId: suppliedRequestId && suppliedRequestId.length <= 128 ? suppliedRequestId : null,
    session,
  });

  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-black tracking-tight text-stone-900">Đơn hàng</h1>
      <form
        action="/admin/orders"
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        method="get"
      >
        <div className="flex-1">
          <label className="text-sm font-bold text-stone-800" htmlFor="admin-order-query">
            Tìm đơn hàng
          </label>
          <input
            autoComplete="off"
            className="mt-2 h-12 w-full rounded-2xl border border-rose-200 bg-white px-4 font-mono text-stone-900 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
            defaultValue={query}
            id="admin-order-query"
            maxLength={64}
            name="q"
            placeholder="Mã đơn, mã nội bộ hoặc mã công khai của món quà"
            spellCheck={false}
          />
        </div>
        <Button type="submit">Tìm</Button>
      </form>
      {result.kind === "found" ? (
        <AdminOrdersView attempts={result.attempts} orders={result.orders} />
      ) : null}
      {result.kind === "not-found" ? (
        <p className="font-semibold text-stone-700" role="status">
          {ADMIN_ORDER_NOT_FOUND}
        </p>
      ) : null}
    </section>
  );
}
