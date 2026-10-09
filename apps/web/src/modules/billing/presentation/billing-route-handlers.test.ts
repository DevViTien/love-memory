import { type OrderDto, OrderResponseSchema } from "@love-memory/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/composition/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/modules/auth/infrastructure/auth-environment", () => ({
  getAuthEnvironment: () => ({ secret: "s".repeat(32) }),
}));
vi.mock("@/composition/rate-limits", () => ({ rateLimiter: { consume: vi.fn() } }));

import { type CheckoutService } from "../application/checkout-service";
import { handleGetOrder, handleStartCheckout } from "./billing-route-handlers";

const publicId = "q1w2e3r4t5y6u7i8";
const orderId = "0b3c5a7e-1f1c-4b8e-9a51-6c0f2d7e8a90";
const key = "9c1b2f0e-6a7d-4c90-8d7a-4a559c1b2f0e";
const order: OrderDto = {
  amountVnd: 49_000,
  checkoutUrl: "https://pay.example/1",
  createdAt: "2026-10-10T10:00:00.000Z",
  currency: "VND",
  expiresAt: "2026-10-10T10:15:00.000Z",
  giftPublicId: publicId,
  orderId,
  planId: "standard",
  status: "pending",
};

function checkoutRequest(init: Readonly<{ body?: string; idempotencyKey?: string | null }> = {}) {
  const idempotencyKey = init.idempotencyKey === undefined ? key : init.idempotencyKey;
  return new Request(`https://love.example/api/gifts/${publicId}/checkout`, {
    body:
      init.body ??
      JSON.stringify({ expectedRevision: 5, planId: "standard", rightsConfirmed: true }),
    headers: {
      "content-type": "application/json",
      "x-request-id": "request-1",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    method: "POST",
  });
}

async function errorOf(response: Response) {
  return ((await response.json()) as { error: { code: string; details?: unknown } }).error;
}

describe("billing routes", () => {
  const startCheckout = vi.fn<CheckoutService["startCheckout"]>();
  const getOrder = vi.fn<CheckoutService["getOrder"]>();
  const limit = vi.fn<() => Promise<Response | null>>();
  const context = { accessors: [], anonymousIdentity: null, userId: "user-1" };
  const dependencies = {
    getContext: () => Promise.resolve(context),
    limit,
    service: () => ({ getOrder, startCheckout }),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    limit.mockResolvedValue(null);
  });

  it("starts a checkout after the publish guards (Checkout for Standard)", async () => {
    startCheckout.mockResolvedValueOnce({ data: order, ok: true });
    const response = await handleStartCheckout(
      checkoutRequest(),
      { params: Promise.resolve({ publicId }) },
      dependencies,
    );

    expect(response.status).toBe(201);
    expect(OrderResponseSchema.parse(await response.json()).data.order).toEqual(order);
    expect(limit).toHaveBeenCalledWith(expect.any(Request), context, "gift-checkout", "request-1");
    expect(startCheckout).toHaveBeenCalledWith({
      expectedRevision: 5,
      idempotencyKey: key,
      planId: "standard",
      publicId,
      userId: "user-1",
    });
  });

  it("refuses a missing key, a bad body, a bad path and a rate-limited request before the service", async () => {
    const params = { params: Promise.resolve({ publicId }) };
    expect(
      (await handleStartCheckout(checkoutRequest({ idempotencyKey: null }), params, dependencies))
        .status,
    ).toBe(400);
    expect(
      (
        await handleStartCheckout(
          checkoutRequest({ body: JSON.stringify({ expectedRevision: 5, planId: "standard" }) }),
          params,
          dependencies,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleStartCheckout(
          checkoutRequest(),
          { params: Promise.resolve({ publicId: "../x" }) },
          dependencies,
        )
      ).status,
    ).toBe(404);
    limit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await handleStartCheckout(checkoutRequest(), params, dependencies)).status).toBe(429);
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it("maps the provider failure and the gift refusals (Provider unreachable)", async () => {
    const params = { params: Promise.resolve({ publicId }) };
    startCheckout.mockResolvedValueOnce({
      error: { code: "PAYMENT_PROVIDER_UNAVAILABLE" },
      ok: false,
    });
    let response = await handleStartCheckout(checkoutRequest(), params, dependencies);
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      details: { reason: "PAYMENT_PROVIDER_UNAVAILABLE" },
    });

    startCheckout.mockResolvedValueOnce({ error: { code: "NO_PAYMENT_REQUIRED" }, ok: false });
    response = await handleStartCheckout(checkoutRequest(), params, dependencies);
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatchObject({ details: { reason: "NO_PAYMENT_REQUIRED" } });

    startCheckout.mockRejectedValueOnce(new Error("boom"));
    expect((await handleStartCheckout(checkoutRequest(), params, dependencies)).status).toBe(500);
  });

  it("reads the owner's order, never caches it, and hides any other one (Another account)", async () => {
    getOrder.mockResolvedValueOnce({ data: order, ok: true });
    const request = new Request(`https://love.example/api/orders/${orderId}`);
    let response = await handleGetOrder(
      request,
      { params: Promise.resolve({ orderId }) },
      dependencies,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(OrderResponseSchema.parse(await response.json()).data.order).toEqual(order);
    expect(limit).toHaveBeenCalledWith(
      expect.any(Request),
      context,
      "order-read",
      expect.any(String),
    );

    getOrder.mockResolvedValueOnce({ error: { code: "NOT_FOUND" }, ok: false });
    response = await handleGetOrder(
      request,
      { params: Promise.resolve({ orderId }) },
      dependencies,
    );
    expect(response.status).toBe(404);

    response = await handleGetOrder(
      request,
      { params: Promise.resolve({ orderId: "not-a-uuid" }) },
      dependencies,
    );
    expect(response.status).toBe(404);

    getOrder.mockRejectedValueOnce(new Error("boom"));
    response = await handleGetOrder(
      request,
      { params: Promise.resolve({ orderId }) },
      dependencies,
    );
    expect(response.status).toBe(500);

    limit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    response = await handleGetOrder(
      request,
      { params: Promise.resolve({ orderId }) },
      dependencies,
    );
    expect(response.status).toBe(429);
  });
});
