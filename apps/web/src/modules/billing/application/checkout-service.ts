import { type OrderDto } from "@love-memory/contracts";
import {
  type BillingProviderId,
  currentPlan,
  type Order,
  ORDER_CHECKOUT_TTL_MILLISECONDS,
  orderDescription,
  type PlanId,
} from "@love-memory/domain";

import {
  type GiftServiceError,
  type GiftServiceResult,
} from "@/modules/gifts/application/gift-service";

import { type BillingProvider } from "./billing-provider";

export type CheckoutServiceError =
  GiftServiceError | Readonly<{ code: "PAYMENT_PROVIDER_UNAVAILABLE" }>;

export type CheckoutResult<T> =
  Readonly<{ data: T; ok: true }> | Readonly<{ error: CheckoutServiceError; ok: false }>;

/** What the gift side answers for a checkout: the first-publish checks, nothing written. */
export type CheckoutGate = (
  input: Readonly<{
    expectedRevision: number;
    planId: PlanId;
    publicId: string;
    userId: string | null;
  }>,
) => Promise<
  GiftServiceResult<
    Readonly<{ giftId: string; giftPublicId: string; ownerId: string; revision: number }>
  >
>;

/** An order with its checkout idempotency record (`ownerId` + key, a per-owner namespace). */
export type StoredOrder = Order &
  Readonly<{ idempotencyKey: string | null; requestFingerprint: string }>;

export type OpenCheckoutOutcome =
  | Readonly<{ kind: "created"; superseded: readonly Order[] }>
  /** Another pending order of the gift was opened concurrently. */
  | Readonly<{ kind: "gift-busy" }>
  /** The same owner and key committed first. */
  | Readonly<{ kind: "key-taken" }>;

export interface OrderRepository {
  /** One transaction: every `pending` order of the gift becomes `cancelled`, then the insert. */
  openCheckout(order: StoredOrder, now: Date): Promise<OpenCheckoutOutcome>;
  attachPaymentLink(
    orderId: string,
    link: Readonly<{ checkoutUrl: string; providerPaymentId: string }>,
    now: Date,
  ): Promise<Order | null>;
  /** `pending` → `failed`, releasing the idempotency key so a retry opens a new order. */
  markFailed(orderId: string, now: Date): Promise<void>;
  /** `pending` → `cancelled` or `expired`; the order as stored afterwards. */
  closePending(orderId: string, status: "cancelled" | "expired", now: Date): Promise<Order | null>;
  findByIdempotencyKey(ownerId: string, key: string): Promise<StoredOrder | null>;
  /** The owner filter is part of the query: another owner's order is never read. */
  findForOwner(orderId: string, ownerId: string): Promise<Order | null>;
}

type Dependencies = Readonly<{
  clock?: () => Date;
  createId: () => string;
  createOrderCode: () => number;
  gate: CheckoutGate;
  orders: OrderRepository;
  /** The configured provider, or `null` while checkout is off. */
  provider: () => BillingProvider | null;
  /** Reported and swallowed: a failed cleanup never changes a response. */
  reportFailure: (operation: string, error: unknown) => void;
  /** The return and cancel pages on the public origin. */
  urls: () => Readonly<{
    cancel: (orderId: string) => string;
    return: (orderId: string) => string;
  }>;
}>;

export function toOrderDto(order: Order): OrderDto {
  return {
    amountVnd: order.amountVnd,
    checkoutUrl: order.status === "pending" ? order.checkoutUrl : null,
    createdAt: order.createdAt.toISOString(),
    currency: order.currency,
    expiresAt: order.expiresAt.toISOString(),
    giftPublicId: order.giftPublicId,
    orderId: order.id,
    planId: order.planId,
    status: order.status,
  };
}

const ok = <T>(data: T): CheckoutResult<T> => ({ data, ok: true });
const fail = (error: CheckoutServiceError): CheckoutResult<never> => ({ error, ok: false });

/** `billing-checkout`: checkout creation and the owner's order status with reconciliation. */
export function createCheckoutService({
  clock = () => new Date(),
  createId,
  createOrderCode,
  gate,
  orders,
  provider,
  reportFailure,
  urls,
}: Dependencies) {
  async function cancelSuperseded(superseded: readonly Order[]) {
    for (const order of superseded) {
      const links = provider();
      if (!links || links.id !== order.provider) continue;
      try {
        await links.cancelPaymentLink(order.orderCode, "Superseded by a new checkout");
      } catch (error) {
        reportFailure("billing.cancel-superseded", error);
      }
    }
  }

  return {
    async startCheckout(
      input: Readonly<{
        expectedRevision: number;
        idempotencyKey: string;
        planId: PlanId;
        publicId: string;
        userId: string | null;
      }>,
    ): Promise<CheckoutResult<OrderDto>> {
      if (!input.userId) return fail({ code: "NOT_AUTHENTICATED" });
      const requestFingerprint = JSON.stringify([
        "checkout",
        input.publicId,
        input.expectedRevision,
        input.planId,
      ]);

      const replay = await orders.findByIdempotencyKey(input.userId, input.idempotencyKey);
      if (replay) {
        if (replay.requestFingerprint !== requestFingerprint) {
          return fail({ code: "IDEMPOTENCY_CONFLICT" });
        }
        if (replay.status === "pending" && replay.checkoutUrl) return ok(toOrderDto(replay));
        if (replay.status !== "pending") return fail({ code: "INVALID_STATE" });
        // A pending order without a link: its request died before the provider answered.
        await orders.markFailed(replay.id, clock());
      }

      const checked = await gate(input);
      if (!checked.ok) return checked;
      const links = provider();
      if (!links) return fail({ code: "PAYMENT_PROVIDER_UNAVAILABLE" });

      const now = clock();
      const plan = currentPlan(input.planId);
      const order: StoredOrder = {
        amountVnd: plan.priceVnd,
        checkoutUrl: null,
        createdAt: now,
        currency: "VND",
        expiresAt: new Date(now.getTime() + ORDER_CHECKOUT_TTL_MILLISECONDS),
        giftId: checked.data.giftId,
        giftPublicId: checked.data.giftPublicId,
        id: createId(),
        idempotencyKey: input.idempotencyKey,
        orderCode: createOrderCode(),
        ownerId: checked.data.ownerId,
        planId: plan.planId,
        planVersion: plan.planVersion,
        provider: links.id,
        providerPaymentId: null,
        requestFingerprint,
        revision: checked.data.revision,
        // The checkout body carries `rightsConfirmed: true`, checked by the contract.
        rightsConfirmedAt: now,
        status: "pending",
        updatedAt: now,
      };
      const opened = await orders.openCheckout(order, now);
      if (opened.kind === "gift-busy") return fail({ code: "INVALID_STATE" });
      if (opened.kind === "key-taken") {
        const winner = await orders.findByIdempotencyKey(input.userId, input.idempotencyKey);
        return winner?.requestFingerprint === requestFingerprint &&
          winner.status === "pending" &&
          winner.checkoutUrl
          ? ok(toOrderDto(winner))
          : fail({ code: "INVALID_STATE" });
      }

      let link;
      try {
        const pages = urls();
        link = await links.createPaymentLink({
          amountVnd: order.amountVnd,
          cancelUrl: pages.cancel(order.id),
          description: orderDescription(order.orderCode),
          expiresAt: order.expiresAt,
          itemName: `LoveMemory - ${plan.name}`,
          orderCode: order.orderCode,
          returnUrl: pages.return(order.id),
        });
      } catch (error) {
        reportFailure("billing.create-payment-link", error);
        await orders.markFailed(order.id, clock());
        return fail({ code: "PAYMENT_PROVIDER_UNAVAILABLE" });
      }

      const attached = await orders.attachPaymentLink(order.id, link, clock());
      await cancelSuperseded(opened.superseded);
      // Closed meanwhile by a newer checkout of the same gift.
      if (!attached) return fail({ code: "INVALID_STATE" });
      return ok(toOrderDto(attached));
    },

    /** The owner's order; a `pending` one is first reconciled with the provider's verified status. */
    async getOrder(
      input: Readonly<{ orderId: string; userId: string | null }>,
    ): Promise<CheckoutResult<OrderDto>> {
      if (!input.userId) return fail({ code: "NOT_FOUND" });
      const order = await orders.findForOwner(input.orderId, input.userId);
      if (!order) return fail({ code: "NOT_FOUND" });
      if (order.status !== "pending") return ok(toOrderDto(order));

      const links = provider();
      if (!links || links.id !== (order.provider satisfies BillingProviderId)) {
        return ok(toOrderDto(order));
      }
      try {
        const payment = await links.getPayment(order.orderCode);
        // `PAID` is left to the verified webhook and reconciliation of fulfillment.
        if (payment.status === "CANCELLED" || payment.status === "EXPIRED") {
          const closed = await orders.closePending(
            order.id,
            payment.status === "CANCELLED" ? "cancelled" : "expired",
            clock(),
          );
          return ok(toOrderDto(closed ?? order));
        }
      } catch (error) {
        reportFailure("billing.read-payment", error);
      }
      return ok(toOrderDto(order));
    },
  } as const;
}

export type CheckoutService = ReturnType<typeof createCheckoutService>;
