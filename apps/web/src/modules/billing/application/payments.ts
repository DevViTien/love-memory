import { type BillingProviderId, type Order } from "@love-memory/domain";
import { z } from "zod";

import { type JobHandler, JobFailure, type JobType } from "@/modules/jobs/application/job-registry";

/** Publishes the gift a paid order bought (`billing-checkout` "Paid order fulfillment"). */
export const PUBLISH_FINALIZE_JOB: JobType = "publish.finalize.v1";

/** Reads a checkout's payment once its link has expired (`billing-checkout` "Payment reconciliation"). */
export const PAYMENT_RECONCILE_JOB: JobType = "payment.reconcile.v1";

/** The reconciliation runs this long after the payment link expires. */
export const PAYMENT_RECONCILE_DELAY_MILLISECONDS = 2 * 60 * 1000;

export type PaymentSource = "fake" | "reconciliation" | "webhook";

/** A payment the provider confirmed: a verified webhook, a verified status read, or the fake. */
export type VerifiedPayment = Readonly<{
  amountVnd: number;
  currency: string;
  orderCode: number;
  provider: BillingProviderId;
  /** The provider's reference of this payment; one record per `{provider}:{reference}`. */
  reference: string;
  source: PaymentSource;
}>;

export type PaymentOutcome =
  | "already_paid"
  | "amount_mismatch"
  /** The same provider reference was recorded before: nothing happens again. */
  | "duplicate"
  | "applied"
  | "unknown_order";

export interface PaymentRepository {
  /**
   * One transaction: the payment record, and for a matching order that is `pending`, `cancelled`
   * or `expired`, the move to `paid` with its `publish.finalize.v1` and `payment_received` jobs.
   */
  apply(payment: VerifiedPayment, now: Date): Promise<PaymentOutcome>;
}

type Dependencies = Readonly<{
  clock?: () => Date;
  payments: PaymentRepository;
  /** Reported for support: never the payment's reference, amount or order. */
  reportFailure: (operation: string, error: unknown) => void;
  /** Wakes the worker for the jobs an applied payment committed; never throws. */
  wakeJobs: () => Promise<void>;
}>;

export class PaymentNeedsSupport extends Error {
  constructor(readonly outcome: PaymentOutcome) {
    super(`Payment needs support: ${outcome}`);
    this.name = "PaymentNeedsSupport";
  }
}

/**
 * ADR-0009: the only path to `paid`. Idempotent per provider reference; the amount and currency
 * must match the order's snapshot exactly.
 */
export function createPaymentService({
  clock = () => new Date(),
  payments,
  reportFailure,
  wakeJobs,
}: Dependencies) {
  return {
    async recordVerifiedPayment(payment: VerifiedPayment): Promise<PaymentOutcome> {
      const outcome = await payments.apply(payment, clock());
      if (outcome === "applied") await wakeJobs();
      // A mismatched amount, or money for an order that is already paid, needs a person.
      if (outcome === "amount_mismatch" || outcome === "unknown_order") {
        reportFailure(`billing.payment.${outcome}`, new PaymentNeedsSupport(outcome));
      }
      return outcome;
    },
  } as const;
}

export type PaymentService = ReturnType<typeof createPaymentService>;

const OrderJobPayloadSchema = z.object({ orderId: z.uuid() }).strict();

export type FulfillmentResult =
  | Readonly<{ kind: "published" }>
  /** The gift changed concurrently: a retry can succeed. */
  | Readonly<{ kind: "retry" }>
  /** The gift cannot be published as it is; the owner finishes it in the Studio, paid. */
  | Readonly<{ kind: "blocked"; reason: string }>;

/** `publish.finalize.v1`: idempotent, since a fulfilled order is skipped and publishing replays. */
export function createPublishFinalizeHandler({
  finalize,
  findOrder,
}: Readonly<{
  finalize: (order: Order) => Promise<FulfillmentResult>;
  findOrder: (orderId: string) => Promise<Order | null>;
}>): JobHandler<{ orderId: string }> {
  return {
    maxAttempts: 6,
    payload: OrderJobPayloadSchema,
    async run({ orderId }) {
      const order = await findOrder(orderId);
      if (!order || order.status !== "paid") return;
      const result = await finalize(order);
      if (result.kind === "retry") throw new JobFailure("FINALIZE_CONFLICT", true);
      if (result.kind === "blocked") {
        // Dead, so support sees it; the owner can still publish the paid gift in the Studio.
        throw new JobFailure(`FINALIZE_${result.reason}`, false);
      }
    },
    type: PUBLISH_FINALIZE_JOB,
  };
}

/** `payment.reconcile.v1`: after the link expired, the provider's verified status decides. */
export function createPaymentReconcileHandler({
  findOrder,
  reconcile,
}: Readonly<{
  findOrder: (orderId: string) => Promise<Order | null>;
  /** The order after reconciliation; it throws when the provider cannot be read. */
  reconcile: (order: Order) => Promise<Order>;
}>): JobHandler<{ orderId: string }> {
  return {
    maxAttempts: 6,
    payload: OrderJobPayloadSchema,
    async run({ orderId }) {
      const order = await findOrder(orderId);
      if (!order || order.status !== "pending") return;
      let reconciled: Order;
      try {
        reconciled = await reconcile(order);
      } catch {
        throw new JobFailure("PROVIDER_UNAVAILABLE", true);
      }
      if (reconciled.status === "pending") throw new JobFailure("PAYMENT_PENDING", true);
    },
    type: PAYMENT_RECONCILE_JOB,
  };
}
