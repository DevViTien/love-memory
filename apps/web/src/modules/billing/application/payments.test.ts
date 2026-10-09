import { type Order } from "@love-memory/domain";
import { describe, expect, it, vi } from "vitest";

import { JobFailure } from "@/modules/jobs/application/job-registry";

import {
  createPaymentReconcileHandler,
  createPaymentService,
  createPublishFinalizeHandler,
  type PaymentRepository,
  PaymentNeedsSupport,
  type VerifiedPayment,
} from "./payments";

const orderId = "0b3c5a7e-1f1c-4b8e-9a51-6c0f2d7e8a90";
const now = new Date("2026-10-10T10:00:00.000Z");
const context = { jobId: "job-1", now };

const payment: VerifiedPayment = {
  amountVnd: 49_000,
  currency: "VND",
  orderCode: 123_456_789_012,
  provider: "payos",
  reference: "TF230204212323",
  source: "webhook",
};

function order(status: Order["status"]): Order {
  return {
    amountVnd: 49_000,
    checkoutUrl: null,
    createdAt: now,
    currency: "VND",
    expiresAt: now,
    giftId: "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
    giftPublicId: "pub-1",
    id: orderId,
    orderCode: 123_456_789_012,
    ownerId: "user-1",
    planId: "standard",
    planVersion: 1,
    provider: "payos",
    providerPaymentId: "p1",
    revision: 5,
    rightsConfirmedAt: now,
    status,
    updatedAt: now,
  };
}

describe("payment service", () => {
  function serviceAnswering(outcome: Awaited<ReturnType<PaymentRepository["apply"]>>) {
    const apply = vi.fn<PaymentRepository["apply"]>(() => Promise.resolve(outcome));
    const wakeJobs = vi.fn(() => Promise.resolve());
    const reportFailure = vi.fn();
    const service = createPaymentService({
      clock: () => now,
      payments: { apply },
      reportFailure,
      wakeJobs,
    });
    return { apply, reportFailure, service, wakeJobs };
  }

  it("applies a verified payment once and wakes fulfillment (Payment applied)", async () => {
    const { apply, reportFailure, service, wakeJobs } = serviceAnswering("applied");

    await expect(service.recordVerifiedPayment(payment)).resolves.toBe("applied");
    expect(apply).toHaveBeenCalledWith(payment, now);
    expect(wakeJobs).toHaveBeenCalledTimes(1);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("changes nothing for a duplicate notification (Duplicate webhook)", async () => {
    const { service, wakeJobs } = serviceAnswering("duplicate");
    await expect(service.recordVerifiedPayment(payment)).resolves.toBe("duplicate");
    expect(wakeJobs).not.toHaveBeenCalled();
  });

  it("reports a mismatched amount or an unknown order for support, without applying it (Amount mismatch)", async () => {
    for (const outcome of ["amount_mismatch", "unknown_order"] as const) {
      const { reportFailure, service, wakeJobs } = serviceAnswering(outcome);
      await expect(service.recordVerifiedPayment(payment)).resolves.toBe(outcome);
      expect(wakeJobs).not.toHaveBeenCalled();
      expect(reportFailure).toHaveBeenCalledWith(
        `billing.payment.${outcome}`,
        expect.any(PaymentNeedsSupport),
      );
    }
    const { reportFailure, service } = serviceAnswering("already_paid");
    await service.recordVerifiedPayment(payment);
    expect(reportFailure).not.toHaveBeenCalled();
  });
});

describe("publish.finalize.v1", () => {
  it("publishes a paid order, and skips any other (Browser closed before return)", async () => {
    const finalize = vi.fn(() => Promise.resolve({ kind: "published" as const }));
    const findOrder = vi.fn((id: string) => Promise.resolve(id === orderId ? order("paid") : null));
    const handler = createPublishFinalizeHandler({ finalize, findOrder });

    await handler.run({ orderId }, context);
    expect(finalize).toHaveBeenCalledWith(order("paid"));

    finalize.mockClear();
    findOrder.mockResolvedValueOnce(order("fulfilled"));
    await handler.run({ orderId }, context);
    await handler.run({ orderId: "1d1b1c1a-0000-4000-8000-000000000001" }, context);
    expect(finalize).not.toHaveBeenCalled();
    expect(handler).toMatchObject({ maxAttempts: 6, type: "publish.finalize.v1" });
    expect(handler.payload.safeParse({ orderId, giftId: "x" }).success).toBe(false);
  });

  it("retries a conflict and dead-letters a blocked gift (Paid but finalize fails, then retry)", async () => {
    const findOrder = () => Promise.resolve(order("paid"));
    const retrying = createPublishFinalizeHandler({
      finalize: () => Promise.resolve({ kind: "retry" }),
      findOrder,
    });
    await expect(retrying.run({ orderId }, context)).rejects.toMatchObject({
      code: "FINALIZE_CONFLICT",
      retryable: true,
    });

    const blocked = createPublishFinalizeHandler({
      finalize: () => Promise.resolve({ kind: "blocked", reason: "INVALID_CONTENT" }),
      findOrder,
    });
    const failure = await blocked.run({ orderId }, context).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JobFailure);
    expect(failure).toMatchObject({ code: "FINALIZE_INVALID_CONTENT", retryable: false });
  });
});

describe("payment.reconcile.v1", () => {
  it("reconciles a pending order and retries while the provider has no verdict", async () => {
    const reconcile = vi.fn((current: Order) =>
      Promise.resolve({ ...current, status: "paid" as const }),
    );
    const handler = createPaymentReconcileHandler({
      findOrder: () => Promise.resolve(order("pending")),
      reconcile,
    });
    await handler.run({ orderId }, context);
    expect(reconcile).toHaveBeenCalledTimes(1);

    const pending = createPaymentReconcileHandler({
      findOrder: () => Promise.resolve(order("pending")),
      reconcile: (current) => Promise.resolve(current),
    });
    await expect(pending.run({ orderId }, context)).rejects.toMatchObject({
      code: "PAYMENT_PENDING",
      retryable: true,
    });

    const unreachable = createPaymentReconcileHandler({
      findOrder: () => Promise.resolve(order("pending")),
      reconcile: () => Promise.reject(new Error("offline")),
    });
    await expect(unreachable.run({ orderId }, context)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
    });
  });

  it("leaves a closed or unknown order alone", async () => {
    const reconcile = vi.fn();
    for (const found of [order("cancelled"), null]) {
      const handler = createPaymentReconcileHandler({
        findOrder: () => Promise.resolve(found),
        reconcile,
      });
      await handler.run({ orderId }, context);
    }
    expect(reconcile).not.toHaveBeenCalled();
  });
});
