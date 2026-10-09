import { randomInt, randomUUID } from "node:crypto";

import { ORDER_CODE_MAX, ORDER_CODE_MIN } from "@love-memory/domain";

import { giftService } from "@/composition/gifts";
import { type BillingEnvironment, getBillingEnvironment } from "@/config/billing";
import { type BillingProvider } from "@/modules/billing/application/billing-provider";
import { createCheckoutService } from "@/modules/billing/application/checkout-service";
import {
  cancelFakePaymentLink,
  createFakeProvider,
  fakePaymentLinks,
} from "@/modules/billing/infrastructure/fake-provider";
import { mongoOrderRepository } from "@/modules/billing/infrastructure/mongo-order-repository";
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

export const checkoutService = createCheckoutService({
  createId: randomUUID,
  // `randomInt` needs max - min below 2^48; 12-digit codes fit.
  createOrderCode: () => randomInt(ORDER_CODE_MIN, ORDER_CODE_MAX + 1),
  gate: (input) => giftService.checkCheckout(input),
  orders: mongoOrderRepository,
  provider: () => billingProviderFor(getBillingEnvironment()),
  reportFailure: (operation, error) => reportOperationalFailure(operation, error, "billing"),
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

/** The fake provider's links (development and E2E only), for its checkout page and action. */
export const fakeCheckout = {
  cancel: (paymentId: string) => cancelFakePaymentLink(paymentId),
  find: (paymentId: string) => fakePaymentLinks().get(paymentId) ?? null,
} as const;
