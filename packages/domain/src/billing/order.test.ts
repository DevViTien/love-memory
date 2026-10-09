import { describe, expect, it } from "vitest";

import {
  canTransitionOrder,
  ORDER_CODE_MAX,
  ORDER_CODE_MIN,
  ORDER_STATUSES,
  orderDescription,
  OrderSchema,
} from "./order";

const order = {
  amountVnd: 49_000,
  checkoutUrl: null,
  createdAt: new Date("2026-10-10T10:00:00.000Z"),
  currency: "VND",
  expiresAt: new Date("2026-10-10T10:15:00.000Z"),
  giftId: "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
  giftPublicId: "pub-1",
  id: "0b3c5a7e-1f1c-4b8e-9a51-6c0f2d7e8a90",
  orderCode: 123_456_789_012,
  ownerId: "user-1",
  planId: "standard",
  planVersion: 1,
  provider: "fake",
  providerPaymentId: null,
  revision: 5,
  rightsConfirmedAt: new Date("2026-10-10T10:00:00.000Z"),
  status: "pending",
  updatedAt: new Date("2026-10-10T10:00:00.000Z"),
} as const;

describe("orders", () => {
  it("allows exactly the transitions of the state table", () => {
    const allowed = ORDER_STATUSES.flatMap((from) =>
      ORDER_STATUSES.filter((to) => canTransitionOrder(from, to)).map((to) => `${from}>${to}`),
    );
    expect(allowed.sort()).toEqual(
      [
        "cancelled>paid",
        "expired>paid",
        "fulfilled>refunded",
        "paid>fulfilled",
        "paid>refunded",
        "pending>cancelled",
        "pending>expired",
        "pending>failed",
        "pending>paid",
      ].sort(),
    );
  });

  it("describes an order by its code only, within 25 characters", () => {
    expect(orderDescription(ORDER_CODE_MAX)).toBe("LM 999999999999");
    expect(orderDescription(ORDER_CODE_MAX).length).toBeLessThanOrEqual(25);
  });

  it("validates a stored order strictly", () => {
    expect(OrderSchema.parse(order)).toEqual(order);
    expect(OrderSchema.safeParse({ ...order, orderCode: ORDER_CODE_MIN - 1 }).success).toBe(false);
    expect(OrderSchema.safeParse({ ...order, currency: "USD" }).success).toBe(false);
    expect(OrderSchema.safeParse({ ...order, status: "open" }).success).toBe(false);
    expect(OrderSchema.safeParse({ ...order, extra: true }).success).toBe(false);
  });
});
