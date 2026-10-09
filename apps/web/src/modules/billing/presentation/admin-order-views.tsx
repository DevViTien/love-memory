import { type Order } from "@love-memory/domain";
import Link from "next/link";

import { formatAdminTime } from "@/modules/admin/presentation/admin-views";

import { type AdminPaymentAttempt } from "../application/order-lookup";

export const ADMIN_ORDER_NOT_FOUND = "Không có đơn hàng nào khớp.";

const PAYMENT_OUTCOME_LABELS: Readonly<Record<string, string>> = {
  already_paid: "Đơn đã được thanh toán trước đó",
  amount_mismatch: "Sai số tiền — cần xử lý",
  applied: "Đã ghi nhận",
  unknown_order: "Không khớp đơn nào — cần xử lý",
};

/** `billing-checkout` "Admin order lookup": orders and the provider payments recorded for them. */
export function AdminOrdersView({
  attempts,
  orders,
}: Readonly<{ attempts: readonly AdminPaymentAttempt[]; orders: readonly Order[] }>) {
  return (
    <div className="space-y-4">
      {orders.map((order) => {
        const payments = attempts.filter((attempt) => attempt.orderId === order.id);
        return (
          <section
            aria-label={`Đơn ${order.orderCode}`}
            className="rounded-2xl border border-stone-200 bg-white p-5"
            key={order.id}
          >
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
              <dt className="font-bold text-stone-700">Mã đơn</dt>
              <dd className="font-mono">{order.orderCode}</dd>
              <dt className="font-bold text-stone-700">Mã nội bộ</dt>
              <dd className="font-mono">{order.id}</dd>
              <dt className="font-bold text-stone-700">Trạng thái</dt>
              <dd>{order.status}</dd>
              <dt className="font-bold text-stone-700">Gói</dt>
              <dd>
                {order.planId} v{order.planVersion} · {order.amountVnd} {order.currency}
              </dd>
              <dt className="font-bold text-stone-700">Cổng</dt>
              <dd>{order.provider}</dd>
              <dt className="font-bold text-stone-700">Món quà</dt>
              <dd className="font-mono">
                <Link
                  className="text-rose-700 underline"
                  href={{ pathname: "/admin", query: { q: order.giftPublicId } }}
                >
                  {order.giftPublicId}
                </Link>
              </dd>
              <dt className="font-bold text-stone-700">Tạo lúc</dt>
              <dd>{formatAdminTime(order.createdAt)}</dd>
              <dt className="font-bold text-stone-700">Thanh toán lúc</dt>
              <dd>{formatAdminTime(order.paidAt ?? null)}</dd>
              <dt className="font-bold text-stone-700">Xuất bản lúc</dt>
              <dd>{formatAdminTime(order.fulfilledAt ?? null)}</dd>
            </dl>
            <h2 className="mt-4 text-sm font-black text-stone-900">Ghi nhận từ cổng thanh toán</h2>
            {payments.length === 0 ? (
              <p className="text-sm text-stone-600">Chưa có.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {payments.map((payment) => (
                  <li key={`${payment.receivedAt.toISOString()}-${payment.source}`}>
                    {formatAdminTime(payment.receivedAt)} · {payment.source} · {payment.amountVnd}{" "}
                    {payment.currency} ·{" "}
                    {PAYMENT_OUTCOME_LABELS[payment.outcome] ?? payment.outcome}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
