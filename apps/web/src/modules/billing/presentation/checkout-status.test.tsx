import { type OrderDto } from "@love-memory/contracts";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHECKOUT_POLL_INTERVAL_MILLISECONDS,
  CHECKOUT_POLL_LIMIT_MILLISECONDS,
  CHECKOUT_POLL_STOPPED,
  CheckoutStatus,
} from "./checkout-status";

const order: OrderDto = {
  amountVnd: 49_000,
  checkoutUrl: "https://pay.example/1",
  createdAt: "2026-10-10T10:00:00.000Z",
  currency: "VND",
  expiresAt: "2026-10-10T10:15:00.000Z",
  giftPublicId: "pub-1",
  orderId: "0b3c5a7e-1f1c-4b8e-9a51-6c0f2d7e8a90",
  planId: "standard",
  status: "pending",
};

function answering(next: OrderDto) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(JSON.stringify({ data: { order: next } }), { status: 200 })),
  );
}

describe("checkout status", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("waits for the server, with a link back to the checkout and the gift (Return before confirmation)", () => {
    render(<CheckoutStatus fetchImpl={answering(order)} initialOrder={order} />);

    expect(screen.getByRole("heading", { name: "Đang chờ xác nhận thanh toán" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tiếp tục thanh toán" }).getAttribute("href")).toBe(
      "https://pay.example/1",
    );
    expect(screen.getByRole("link", { name: "Về trang món quà" }).getAttribute("href")).toBe(
      "/studio/pub-1",
    );
  });

  it("polls the order until it closes", async () => {
    const fetchImpl = answering({ ...order, checkoutUrl: null, status: "cancelled" });
    render(<CheckoutStatus fetchImpl={fetchImpl} initialOrder={order} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKOUT_POLL_INTERVAL_MILLISECONDS);
    });

    expect(fetchImpl).toHaveBeenCalledWith(`/api/orders/${order.orderId}`, expect.anything());
    expect(screen.getByRole("heading", { name: "Thanh toán đã huỷ" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Tiếp tục thanh toán" })).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKOUT_POLL_INTERVAL_MILLISECONDS * 3);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops polling after 3 minutes", async () => {
    let clock = 0;
    const fetchImpl = answering(order);
    render(<CheckoutStatus fetchImpl={fetchImpl} initialOrder={order} now={() => clock} />);

    clock = CHECKOUT_POLL_LIMIT_MILLISECONDS;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKOUT_POLL_INTERVAL_MILLISECONDS);
    });

    expect(screen.getByText(CHECKOUT_POLL_STOPPED)).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps the last state when a poll fails, and never polls a closed order", async () => {
    const failing = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("offline")));
    render(<CheckoutStatus fetchImpl={failing} initialOrder={order} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKOUT_POLL_INTERVAL_MILLISECONDS);
    });
    expect(screen.getByRole("heading", { name: "Đang chờ xác nhận thanh toán" })).toBeTruthy();
    cleanup();

    const idle = answering(order);
    render(<CheckoutStatus fetchImpl={idle} initialOrder={{ ...order, status: "expired" }} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKOUT_POLL_INTERVAL_MILLISECONDS * 2);
    });
    expect(screen.getByRole("heading", { name: "Phiên thanh toán đã hết hạn" })).toBeTruthy();
    expect(idle).not.toHaveBeenCalled();
  });
});
