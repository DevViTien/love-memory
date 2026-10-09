import { randomInt, randomUUID } from "node:crypto";

import { ORDER_CODE_MAX, ORDER_CODE_MIN } from "@love-memory/domain";

import { giftService } from "@/composition/gifts";
import { type BillingEnvironment, getBillingEnvironment } from "@/config/billing";
import { type BillingProvider } from "@/modules/billing/application/billing-provider";
import { createCheckoutService } from "@/modules/billing/application/checkout-service";
import {
  createPaymentService,
  type FulfillmentResult,
  PUBLISH_FINALIZE_JOB,
} from "@/modules/billing/application/payments";
import {
  cancelFakePaymentLink,
  createFakeProvider,
  fakePaymentLinks,
  payFakePaymentLink,
} from "@/modules/billing/infrastructure/fake-provider";
import { mongoOrderRepository } from "@/modules/billing/infrastructure/mongo-order-repository";
import { mongoPaymentRepository } from "@/modules/billing/infrastructure/mongo-payment-repository";
import { createPayosProvider } from "@/modules/billing/infrastructure/payos-provider";
import { reportOperationalFailure } from "@/observability/operational-errors";

/** The configured provider, built per call from the environment, or `null` while checkout is off. */
export function billingProviderFor(environment: BillingEnvironment): BillingProvider | null {
  switch (environment.kind) {
    case "fake":
      return createFakeProvider(() => environment.appUrl);
    case "payos":
      return createPayosProvider(environment);
    case "off":
      return null;
  }
}

const reportBillingFailure = (operation: string, error: unknown) =>
  reportOperationalFailure(operation, error, "billing");

/** The only path to `paid` (ADR-0009): verified webhooks, reconciliation and the fake. */
export const paymentService = createPaymentService({
  payments: mongoPaymentRepository,
  reportFailure: reportBillingFailure,
  // Loaded on use: `composition/jobs` builds on this module.
  wakeJobs: async () =>
    (await import("@/composition/jobs")).jobDispatcher.dispatch(PUBLISH_FINALIZE_JOB),
});

export const checkoutService = createCheckoutService({
  createId: randomUUID,
  // `randomInt` needs max - min below 2^48; 12-digit codes fit.
  createOrderCode: () => randomInt(ORDER_CODE_MIN, ORDER_CODE_MAX + 1),
  gate: (input) => giftService.checkCheckout(input),
  orders: mongoOrderRepository,
  payments: paymentService,
  provider: () => billingProviderFor(getBillingEnvironment()),
  reportFailure: reportBillingFailure,
  urls: () => {
    const environment = getBillingEnvironment();
    const origin = environment.kind === "off" ? "http://localhost" : environment.appUrl;
    const page = (path: string, orderId: string) => {
      const url = new URL(path, origin);
      url.searchParams.set("order", orderId);
      return url.toString();
    };
    return {
      cancel: (orderId) => page("/checkout/cancel", orderId),
      return: (orderId) => page("/checkout/return", orderId),
    };
  },
});

/**
 * `publish.finalize.v1`: the paid order's gift, published by its owner's authority. A concurrent
 * change is retried; anything else leaves the order `paid` for the owner to finish in the Studio.
 */
export async function finalizePaidOrder(
  order: Parameters<typeof giftService.finalizePaidOrder>[0],
): Promise<FulfillmentResult> {
  const result = await giftService.finalizePaidOrder(order);
  if (result.ok) return { kind: "published" };
  if (result.error.code === "REVISION_CONFLICT") return { kind: "retry" };
  // Fulfilled meanwhile by the owner's own publish, or by a parallel run of this job.
  const current = await mongoOrderRepository.findById(order.id);
  if (current?.status === "fulfilled") return { kind: "published" };
  return { kind: "blocked", reason: result.error.code };
}

/** The fake provider's links (development and E2E only), for its checkout page and actions. */
export const fakeCheckout = {
  cancel: (paymentId: string) => cancelFakePaymentLink(paymentId),
  find: (paymentId: string) => fakePaymentLinks().get(paymentId) ?? null,
  /** The fake's own confirmation: recorded like a verified payment, then its return page. */
  pay: async (paymentId: string): Promise<string | null> => {
    const link = payFakePaymentLink(paymentId);
    if (!link) return null;
    await paymentService.recordVerifiedPayment({
      amountVnd: link.amountVnd,
      currency: "VND",
      orderCode: link.orderCode,
      provider: "fake",
      reference: `fake:${paymentId}`,
      source: "fake",
    });
    return link.returnUrl;
  },
} as const;
