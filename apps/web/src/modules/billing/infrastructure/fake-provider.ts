import { randomBytes } from "node:crypto";

import {
  type BillingProvider,
  BillingProviderError,
  type ProviderPaymentStatus,
} from "../application/billing-provider";

/** One payment link of the fake provider (`billing-checkout` "Fake billing provider"). */
export type FakePaymentLink = Readonly<{
  amountVnd: number;
  cancelUrl: string;
  description: string;
  expiresAt: Date;
  orderCode: number;
  paymentId: string;
  returnUrl: string;
  status: ProviderPaymentStatus;
}>;

type FakeStore = Map<string, FakePaymentLink>;

const STORE_KEY = Symbol.for("love-memory.fake-billing-links");

/**
 * The links live in the server's memory, shared through `globalThis` because route handlers and
 * pages may be bundled separately. Development and E2E only: one process, lost on restart.
 */
export function fakePaymentLinks(): FakeStore {
  const holder = globalThis as typeof globalThis & { [STORE_KEY]?: FakeStore };
  holder[STORE_KEY] ??= new Map();
  return holder[STORE_KEY];
}

function findByOrderCode(store: FakeStore, orderCode: number): FakePaymentLink | null {
  for (const link of store.values()) if (link.orderCode === orderCode) return link;
  return null;
}

/** `PENDING` → `CANCELLED`; `false` for an unknown or no longer pending link. */
export function cancelFakePaymentLink(paymentId: string, store = fakePaymentLinks()): boolean {
  const link = store.get(paymentId);
  if (!link || link.status !== "PENDING") return false;
  store.set(paymentId, { ...link, status: "CANCELLED" });
  return true;
}

/** `PENDING` → `PAID`; the link, or `null` for an unknown or no longer pending one. */
export function payFakePaymentLink(
  paymentId: string,
  store = fakePaymentLinks(),
): FakePaymentLink | null {
  const link = store.get(paymentId);
  if (!link || link.status !== "PENDING") return null;
  const paid = { ...link, status: "PAID" as const };
  store.set(paymentId, paid);
  return paid;
}

export function createFakeProvider(
  appUrl: () => URL,
  store: FakeStore = fakePaymentLinks(),
  createPaymentId: () => string = () => randomBytes(16).toString("hex"),
): BillingProvider {
  return {
    cancelPaymentLink(orderCode) {
      const link = findByOrderCode(store, orderCode);
      if (link) cancelFakePaymentLink(link.paymentId, store);
      return Promise.resolve();
    },

    createPaymentLink(input) {
      const paymentId = createPaymentId();
      store.set(paymentId, {
        amountVnd: input.amountVnd,
        cancelUrl: input.cancelUrl,
        description: input.description,
        expiresAt: input.expiresAt,
        orderCode: input.orderCode,
        paymentId,
        returnUrl: input.returnUrl,
        status: "PENDING",
      });
      return Promise.resolve({
        checkoutUrl: new URL(`/billing/fake-checkout/${paymentId}`, appUrl()).toString(),
        providerPaymentId: paymentId,
      });
    },

    getPayment(orderCode) {
      const link = findByOrderCode(store, orderCode);
      // After a restart the link is gone: like an unreachable provider, the order stays as it is.
      if (!link) return Promise.reject(new BillingProviderError("unknown-payment-link"));
      return Promise.resolve({
        amountPaidVnd: link.status === "PAID" ? link.amountVnd : 0,
        amountVnd: link.amountVnd,
        status: link.status,
      });
    },

    id: "fake",
  };
}
