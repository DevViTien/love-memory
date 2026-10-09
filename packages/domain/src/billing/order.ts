import { z } from "zod";

import { PlanIdSchema } from "./plan";

export const ORDER_STATUSES = [
  "pending",
  "paid",
  "fulfilled",
  "cancelled",
  "expired",
  "failed",
  "refunded",
] as const;

export const OrderStatusSchema = z.enum(ORDER_STATUSES);

export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const BILLING_PROVIDERS = ["payos", "fake"] as const;

export const BillingProviderIdSchema = z.enum(BILLING_PROVIDERS);

export type BillingProviderId = z.infer<typeof BillingProviderIdSchema>;

/**
 * `billing-checkout` "Orders and their states". A verified payment beats a local closing, so a
 * `cancelled` or `expired` order may still become `paid`.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  cancelled: ["paid"],
  expired: ["paid"],
  failed: [],
  fulfilled: ["refunded"],
  paid: ["fulfilled", "refunded"],
  pending: ["paid", "cancelled", "expired", "failed"],
  refunded: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** A payment link stays open this long; the order's `expiresAt` follows it. */
export const ORDER_CHECKOUT_TTL_MILLISECONDS = 15 * 60 * 1000;

/** 12-digit order codes: payOS needs a positive integer, unique per merchant. */
export const ORDER_CODE_MIN = 100_000_000_000;
export const ORDER_CODE_MAX = 999_999_999_999;

export const OrderCodeSchema = z.number().int().min(ORDER_CODE_MIN).max(ORDER_CODE_MAX);

/** The transfer description the provider shows and the bank keeps: no gift content, ≤ 25 characters. */
export function orderDescription(orderCode: number): string {
  return `LM ${orderCode}`;
}

export const OrderSchema = z
  .object({
    amountVnd: z.number().int().nonnegative(),
    checkoutUrl: z.url().nullable(),
    createdAt: z.coerce.date(),
    currency: z.literal("VND"),
    expiresAt: z.coerce.date(),
    giftId: z.uuid(),
    giftPublicId: z.string().min(1),
    id: z.uuid(),
    orderCode: OrderCodeSchema,
    ownerId: z.string().min(1),
    planId: PlanIdSchema,
    planVersion: z.number().int().positive(),
    provider: BillingProviderIdSchema,
    providerPaymentId: z.string().min(1).nullable(),
    revision: z.number().int().nonnegative(),
    rightsConfirmedAt: z.coerce.date(),
    status: OrderStatusSchema,
    updatedAt: z.coerce.date(),
  })
  .strict();

export type Order = z.infer<typeof OrderSchema>;
