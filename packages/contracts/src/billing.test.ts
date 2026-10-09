import { describe, expect, it } from "vitest";

import { OrderDtoSchema, OrderResponseSchema, StartCheckoutRequestSchema } from "./billing";

const order = {
  amountVnd: 49_000,
  checkoutUrl: "https://pay.example/checkout/1",
  createdAt: "2026-10-10T10:00:00.000Z",
  currency: "VND",
  expiresAt: "2026-10-10T10:15:00.000Z",
  giftPublicId: "pub-1",
  orderId: "0b3c5a7e-1f1c-4b8e-9a51-6c0f2d7e8a90",
  planId: "standard",
  status: "pending",
} as const;

describe("billing contracts", () => {
  it("accepts the publish body as a checkout body", () => {
    expect(
      StartCheckoutRequestSchema.safeParse({
        expectedRevision: 5,
        planId: "standard",
        rightsConfirmed: true,
      }).success,
    ).toBe(true);
    expect(
      StartCheckoutRequestSchema.safeParse({ expectedRevision: 5, planId: "standard" }).success,
    ).toBe(false);
  });

  it("describes an order strictly", () => {
    expect(OrderDtoSchema.parse(order)).toEqual(order);
    expect(OrderDtoSchema.safeParse({ ...order, checkoutUrl: null }).success).toBe(true);
    expect(OrderDtoSchema.safeParse({ ...order, orderCode: 1 }).success).toBe(false);
    expect(OrderDtoSchema.safeParse({ ...order, status: "open" }).success).toBe(false);
    expect(OrderResponseSchema.safeParse({ data: { order } }).success).toBe(true);
  });
});
