import { type Order } from "@love-memory/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type BillingProvider, BillingProviderError } from "./billing-provider";
import {
  type CheckoutGate,
  createCheckoutService,
  type OpenCheckoutOutcome,
  type OrderRepository,
  type StoredOrder,
} from "./checkout-service";

const now = new Date("2026-10-10T10:00:00.000Z");
const giftId = "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89";
const orderId = "0b3c5a7e-1f1c-4b8e-9a51-6c0f2d7e8a90";
const key = "6f1c4bba-3c1b-4c1e-9a6f-0d2b6e3c9a11";
const input = {
  expectedRevision: 5,
  idempotencyKey: key,
  planId: "standard" as const,
  publicId: "pub-1",
  userId: "user-1",
};
const fingerprint = JSON.stringify(["checkout", "pub-1", 5, "standard"]);

function storedOrder(overrides: Partial<StoredOrder> = {}): StoredOrder {
  return {
    amountVnd: 49_000,
    checkoutUrl: "https://pay.example/1",
    createdAt: now,
    currency: "VND",
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
    giftId,
    giftPublicId: "pub-1",
    id: orderId,
    idempotencyKey: key,
    orderCode: 123_456_789_012,
    ownerId: "user-1",
    planId: "standard",
    planVersion: 1,
    provider: "fake",
    providerPaymentId: "p1",
    requestFingerprint: fingerprint,
    revision: 5,
    rightsConfirmedAt: now,
    status: "pending",
    updatedAt: now,
    ...overrides,
  };
}

describe("checkout service", () => {
  const gate = vi.fn<CheckoutGate>();
  const orders = {
    attachPaymentLink: vi.fn<OrderRepository["attachPaymentLink"]>(),
    closePending: vi.fn<OrderRepository["closePending"]>(),
    findByIdempotencyKey: vi.fn<OrderRepository["findByIdempotencyKey"]>(),
    findForOwner: vi.fn<OrderRepository["findForOwner"]>(),
    markFailed: vi.fn<OrderRepository["markFailed"]>(),
    openCheckout: vi.fn<OrderRepository["openCheckout"]>(),
  };
  const provider = {
    cancelPaymentLink: vi.fn<BillingProvider["cancelPaymentLink"]>(),
    createPaymentLink: vi.fn<BillingProvider["createPaymentLink"]>(),
    getPayment: vi.fn<BillingProvider["getPayment"]>(),
    id: "fake" as const,
  };
  const reportFailure = vi.fn();
  let configured: BillingProvider | null;
  const service = createCheckoutService({
    clock: () => now,
    createId: () => orderId,
    createOrderCode: () => 123_456_789_012,
    gate,
    orders,
    provider: () => configured,
    reportFailure,
    urls: () => ({
      cancel: (id) => `https://lovememory.example/checkout/cancel?order=${id}`,
      return: (id) => `https://lovememory.example/checkout/return?order=${id}`,
    }),
  });

  beforeEach(() => {
    vi.resetAllMocks();
    configured = provider;
    gate.mockResolvedValue({
      data: { giftId, giftPublicId: "pub-1", ownerId: "user-1", revision: 5 },
      ok: true,
    });
    orders.findByIdempotencyKey.mockResolvedValue(null);
    orders.openCheckout.mockResolvedValue({ kind: "created", superseded: [] });
    provider.createPaymentLink.mockResolvedValue({
      checkoutUrl: "https://pay.example/1",
      providerPaymentId: "p1",
    });
    orders.attachPaymentLink.mockImplementation((id, link) =>
      Promise.resolve(storedOrder({ ...link, id })),
    );
  });

  it("opens a pending order and a payment link, writing nothing to the gift (Checkout for Standard)", async () => {
    await expect(service.startCheckout(input)).resolves.toEqual({
      data: {
        amountVnd: 49_000,
        checkoutUrl: "https://pay.example/1",
        createdAt: now.toISOString(),
        currency: "VND",
        expiresAt: "2026-10-10T10:15:00.000Z",
        giftPublicId: "pub-1",
        orderId,
        planId: "standard",
        status: "pending",
      },
      ok: true,
    });

    expect(gate).toHaveBeenCalledWith(input);
    expect(orders.openCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        amountVnd: 49_000,
        checkoutUrl: null,
        idempotencyKey: key,
        planVersion: 1,
        provider: "fake",
        requestFingerprint: fingerprint,
        revision: 5,
        status: "pending",
      }),
      now,
    );
    expect(provider.createPaymentLink).toHaveBeenCalledWith({
      amountVnd: 49_000,
      cancelUrl: `https://lovememory.example/checkout/cancel?order=${orderId}`,
      description: "LM 123456789012",
      expiresAt: new Date("2026-10-10T10:15:00.000Z"),
      itemName: "LoveMemory - Tiêu chuẩn",
      orderCode: 123_456_789_012,
      returnUrl: `https://lovememory.example/checkout/return?order=${orderId}`,
    });
  });

  it("passes the gate's refusals through and opens no order (Free needs no checkout)", async () => {
    gate.mockResolvedValueOnce({ error: { code: "NO_PAYMENT_REQUIRED" }, ok: false });
    await expect(service.startCheckout({ ...input, planId: "free" })).resolves.toEqual({
      error: { code: "NO_PAYMENT_REQUIRED" },
      ok: false,
    });
    await expect(service.startCheckout({ ...input, userId: null })).resolves.toEqual({
      error: { code: "NOT_AUTHENTICATED" },
      ok: false,
    });
    expect(orders.openCheckout).not.toHaveBeenCalled();
  });

  it("fails the order and releases its key when the provider refuses (Provider unreachable)", async () => {
    provider.createPaymentLink.mockRejectedValueOnce(new BillingProviderError("unreachable"));

    await expect(service.startCheckout(input)).resolves.toEqual({
      error: { code: "PAYMENT_PROVIDER_UNAVAILABLE" },
      ok: false,
    });
    expect(orders.markFailed).toHaveBeenCalledWith(orderId, now);
    expect(orders.attachPaymentLink).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledWith(
      "billing.create-payment-link",
      expect.any(BillingProviderError),
    );

    configured = null;
    await expect(service.startCheckout(input)).resolves.toEqual({
      error: { code: "PAYMENT_PROVIDER_UNAVAILABLE" },
      ok: false,
    });
  });

  it("replays a pending order for the same owner, key and body (Replayed checkout)", async () => {
    orders.findByIdempotencyKey.mockResolvedValueOnce(storedOrder());

    await expect(service.startCheckout(input)).resolves.toMatchObject({
      data: { checkoutUrl: "https://pay.example/1", orderId },
      ok: true,
    });
    expect(orders.findByIdempotencyKey).toHaveBeenCalledWith("user-1", key);
    expect(gate).not.toHaveBeenCalled();
    expect(provider.createPaymentLink).not.toHaveBeenCalled();
  });

  it("refuses a key reused for another body or for a closed order", async () => {
    orders.findByIdempotencyKey.mockResolvedValueOnce(
      storedOrder({ requestFingerprint: JSON.stringify(["checkout", "pub-1", 6, "standard"]) }),
    );
    await expect(service.startCheckout(input)).resolves.toEqual({
      error: { code: "IDEMPOTENCY_CONFLICT" },
      ok: false,
    });

    orders.findByIdempotencyKey.mockResolvedValueOnce(storedOrder({ status: "cancelled" }));
    await expect(service.startCheckout(input)).resolves.toEqual({
      error: { code: "INVALID_STATE" },
      ok: false,
    });
    expect(orders.openCheckout).not.toHaveBeenCalled();
  });

  it("fails a pending order whose link was never created, then opens a new one", async () => {
    orders.findByIdempotencyKey.mockResolvedValueOnce(storedOrder({ checkoutUrl: null }));

    await expect(service.startCheckout(input)).resolves.toMatchObject({ ok: true });
    expect(orders.markFailed).toHaveBeenCalledWith(orderId, now);
    expect(orders.openCheckout).toHaveBeenCalledTimes(1);
  });

  it("cancels superseded links at the provider, best effort (One pending order per gift)", async () => {
    const older: Order = { ...storedOrder({ id: "1d1b1c1a-0000-4000-8000-000000000001" }) };
    orders.openCheckout.mockResolvedValueOnce({ kind: "created", superseded: [older] });
    provider.cancelPaymentLink.mockRejectedValueOnce(new BillingProviderError("unreachable"));

    await expect(service.startCheckout(input)).resolves.toMatchObject({ ok: true });
    expect(provider.cancelPaymentLink).toHaveBeenCalledWith(
      123_456_789_012,
      "Superseded by a new checkout",
    );
    expect(reportFailure).toHaveBeenCalledWith(
      "billing.cancel-superseded",
      expect.any(BillingProviderError),
    );

    orders.openCheckout.mockResolvedValueOnce({
      kind: "created",
      superseded: [{ ...older, provider: "payos" }],
    });
    provider.cancelPaymentLink.mockClear();
    await service.startCheckout(input);
    expect(provider.cancelPaymentLink).not.toHaveBeenCalled();
  });

  it("answers a concurrent checkout of the gift, or of the same key", async () => {
    orders.openCheckout.mockResolvedValueOnce({ kind: "gift-busy" } satisfies OpenCheckoutOutcome);
    await expect(service.startCheckout(input)).resolves.toEqual({
      error: { code: "INVALID_STATE" },
      ok: false,
    });

    orders.openCheckout.mockResolvedValueOnce({ kind: "key-taken" });
    orders.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(storedOrder());
    await expect(service.startCheckout(input)).resolves.toMatchObject({
      data: { orderId },
      ok: true,
    });

    orders.openCheckout.mockResolvedValueOnce({ kind: "key-taken" });
    orders.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    await expect(service.startCheckout(input)).resolves.toEqual({
      error: { code: "INVALID_STATE" },
      ok: false,
    });

    orders.attachPaymentLink.mockResolvedValueOnce(null);
    await expect(service.startCheckout(input)).resolves.toEqual({
      error: { code: "INVALID_STATE" },
      ok: false,
    });
  });

  describe("order status", () => {
    it("answers only the owner (Another account)", async () => {
      orders.findForOwner.mockResolvedValueOnce(null);
      await expect(service.getOrder({ orderId, userId: "user-2" })).resolves.toEqual({
        error: { code: "NOT_FOUND" },
        ok: false,
      });
      expect(orders.findForOwner).toHaveBeenCalledWith(orderId, "user-2");
      await expect(service.getOrder({ orderId, userId: null })).resolves.toEqual({
        error: { code: "NOT_FOUND" },
        ok: false,
      });
    });

    it("closes a pending order the provider cancelled or expired (Owner reads a cancelled checkout)", async () => {
      for (const [status, closed] of [
        ["CANCELLED", "cancelled"],
        ["EXPIRED", "expired"],
      ] as const) {
        orders.findForOwner.mockResolvedValueOnce(storedOrder());
        provider.getPayment.mockResolvedValueOnce({ amountPaidVnd: 0, amountVnd: 49_000, status });
        orders.closePending.mockResolvedValueOnce(storedOrder({ status: closed }));

        await expect(service.getOrder({ orderId, userId: "user-1" })).resolves.toMatchObject({
          data: { checkoutUrl: null, status: closed },
          ok: true,
        });
        expect(orders.closePending).toHaveBeenLastCalledWith(orderId, closed, now);
      }
    });

    it("leaves a paid or unreadable payment pending (Paid at the provider)", async () => {
      orders.findForOwner.mockResolvedValue(storedOrder());
      provider.getPayment.mockResolvedValueOnce({
        amountPaidVnd: 49_000,
        amountVnd: 49_000,
        status: "PAID",
      });
      await expect(service.getOrder({ orderId, userId: "user-1" })).resolves.toMatchObject({
        data: { checkoutUrl: "https://pay.example/1", status: "pending" },
      });

      provider.getPayment.mockRejectedValueOnce(new BillingProviderError("unreachable"));
      await expect(service.getOrder({ orderId, userId: "user-1" })).resolves.toMatchObject({
        data: { status: "pending" },
      });
      expect(reportFailure).toHaveBeenCalledWith("billing.read-payment", expect.any(Error));
      expect(orders.closePending).not.toHaveBeenCalled();
    });

    it("reads a closed order, or an order of another provider, without asking any provider", async () => {
      orders.findForOwner.mockResolvedValueOnce(storedOrder({ status: "cancelled" }));
      await expect(service.getOrder({ orderId, userId: "user-1" })).resolves.toMatchObject({
        data: { status: "cancelled" },
      });
      orders.findForOwner.mockResolvedValueOnce(storedOrder({ provider: "payos" }));
      await expect(service.getOrder({ orderId, userId: "user-1" })).resolves.toMatchObject({
        data: { status: "pending" },
      });
      expect(provider.getPayment).not.toHaveBeenCalled();
    });
  });
});
