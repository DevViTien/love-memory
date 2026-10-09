"use client";

import { type OrderDto, OrderResponseSchema } from "@love-memory/contracts";
import { buttonVariants } from "@love-memory/ui";
import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchWithTimeout } from "@/http/fetch-with-timeout";

export const CHECKOUT_POLL_INTERVAL_MILLISECONDS = 3_000;
export const CHECKOUT_POLL_LIMIT_MILLISECONDS = 3 * 60 * 1000;

/** `billing-checkout` "Return and cancel pages": one heading and line per order status. */
export const CHECKOUT_STATUS_TEXTS: Readonly<
  Record<OrderDto["status"], Readonly<{ heading: string; text: string }>>
> = {
  cancelled: {
    heading: "Thanh toán đã huỷ",
    text: "Món quà vẫn là bản nháp. Bạn có thể thanh toán lại từ trang món quà.",
  },
  expired: {
    heading: "Phiên thanh toán đã hết hạn",
    text: "Món quà vẫn là bản nháp. Bạn có thể thanh toán lại từ trang món quà.",
  },
  failed: {
    heading: "Chưa tạo được phiên thanh toán",
    text: "Chưa có khoản tiền nào được thu. Hãy thử lại từ trang món quà.",
  },
  fulfilled: {
    heading: "Món quà đã được xuất bản",
    text: "Bạn có thể mở trang món quà để lấy đường dẫn gửi cho người nhận.",
  },
  paid: {
    heading: "Đã nhận thanh toán",
    text: "Món quà đang được xuất bản. Trang sẽ tự cập nhật.",
  },
  pending: {
    heading: "Đang chờ xác nhận thanh toán",
    text: "Món quà sẽ được xuất bản ngay khi cổng thanh toán xác nhận. Bạn có thể đóng trang này.",
  },
  refunded: {
    heading: "Thanh toán đã được hoàn tiền",
    text: "Món quà không được xuất bản theo đơn này.",
  },
};

export const CHECKOUT_POLL_STOPPED = "Chưa nhận được xác nhận. Hãy tải lại trang sau ít phút.";

const systemNow = () => Date.now();

/** Statuses that can still change by themselves; polling stops on every other one. */
const CHANGING: readonly OrderDto["status"][] = ["paid", "pending"];

/**
 * The order's state as the server reports it. It polls `GET /api/orders/{orderId}` while the order
 * can still change, for at most 3 minutes, and never reads the provider's query parameters.
 */
export function CheckoutStatus({
  fetchImpl,
  initialOrder,
  now = systemNow,
}: Readonly<{ fetchImpl?: typeof fetch; initialOrder: OrderDto; now?: () => number }>) {
  const [order, setOrder] = useState(initialOrder);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    if (!CHANGING.includes(order.status)) return;
    const startedAt = now();
    let cancelled = false;
    const timer = setInterval(() => {
      if (now() - startedAt >= CHECKOUT_POLL_LIMIT_MILLISECONDS) {
        clearInterval(timer);
        setStopped(true);
        return;
      }
      void (async () => {
        try {
          const response = await fetchWithTimeout(
            fetchImpl ?? fetch,
            `/api/orders/${encodeURIComponent(order.orderId)}`,
            { cache: "no-store" },
            10_000,
          );
          if (!response.ok) return;
          const parsed = OrderResponseSchema.safeParse(await response.json());
          if (parsed.success && !cancelled) setOrder(parsed.data.data.order);
        } catch {
          // A missed poll is retried by the next tick.
        }
      })();
    }, CHECKOUT_POLL_INTERVAL_MILLISECONDS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // Restarted only when the status changes: the next state decides whether to keep polling.
  }, [fetchImpl, now, order.orderId, order.status]);

  const texts = CHECKOUT_STATUS_TEXTS[order.status];
  return (
    <section aria-live="polite" className="space-y-4">
      <h1 className="text-2xl font-black text-stone-900">{texts.heading}</h1>
      <p className="text-stone-700">{texts.text}</p>
      {stopped && order.status === "pending" ? (
        <p className="text-sm font-semibold text-stone-600" role="status">
          {CHECKOUT_POLL_STOPPED}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {order.status === "pending" && order.checkoutUrl ? (
          <a className={buttonVariants({})} href={order.checkoutUrl}>
            Tiếp tục thanh toán
          </a>
        ) : null}
        <Link
          className={buttonVariants({ variant: "outline" })}
          href={`/studio/${order.giftPublicId}`}
        >
          Về trang món quà
        </Link>
      </div>
    </section>
  );
}
