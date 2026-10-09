import "server-only";

import { COLLECTIONS, enqueueJob, getDatabase, getMongoClient } from "@love-memory/database";
import { type Order, OrderSchema } from "@love-memory/domain";
import { MongoServerError } from "mongodb";

import { type OrderRepository, type StoredOrder } from "../application/checkout-service";
import { type AdminOrderLookupRepository } from "../application/order-lookup";
import {
  PAYMENT_RECONCILE_DELAY_MILLISECONDS,
  PAYMENT_RECONCILE_JOB,
} from "../application/payments";

type OrderDocument = Omit<StoredOrder, "id" | "idempotencyKey"> &
  Readonly<{ _id: string; idempotencyKey?: string | null }>;

function toOrder(document: OrderDocument): Order {
  const { _id, idempotencyKey: _key, requestFingerprint: _fingerprint, ...fields } = document;
  return OrderSchema.parse({ ...fields, id: _id });
}

function toStoredOrder(document: OrderDocument): StoredOrder {
  return {
    ...toOrder(document),
    idempotencyKey: document.idempotencyKey ?? null,
    requestFingerprint: document.requestFingerprint,
  };
}

function duplicateKeyIndex(error: unknown): "gift" | "key" | "other" | null {
  if (!(error instanceof MongoServerError) || error.code !== 11000) return null;
  const pattern = (error as MongoServerError & { keyPattern?: Record<string, unknown> }).keyPattern;
  if (pattern && "idempotencyKey" in pattern) return "key";
  if (pattern && "giftId" in pattern) return "gift";
  return "other";
}

async function orders() {
  return (await getDatabase()).collection<OrderDocument>(COLLECTIONS.orders);
}

/** `orders` (`billing-checkout`); every owner read filters by `ownerId`. */
export const mongoOrderRepository: OrderRepository = {
  async attachPaymentLink(orderId, link, now) {
    const updated = await (
      await orders()
    ).findOneAndUpdate(
      { _id: orderId, status: "pending" },
      {
        $set: {
          checkoutUrl: link.checkoutUrl,
          providerPaymentId: link.providerPaymentId,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );
    return updated ? toOrder(updated) : null;
  },

  async closePending(orderId, status, now) {
    const updated = await (
      await orders()
    ).findOneAndUpdate(
      { _id: orderId, status: "pending" },
      { $set: { status, updatedAt: now } },
      { returnDocument: "after" },
    );
    return updated ? toOrder(updated) : null;
  },

  async findByIdempotencyKey(ownerId, key) {
    const document = await (await orders()).findOne({ idempotencyKey: key, ownerId });
    return document ? toStoredOrder(document) : null;
  },

  async findById(orderId) {
    const document = await (await orders()).findOne({ _id: orderId });
    return document ? toOrder(document) : null;
  },

  async findForOwner(orderId, ownerId) {
    const document = await (await orders()).findOne({ _id: orderId, ownerId });
    return document ? toOrder(document) : null;
  },

  async markFailed(orderId, now) {
    await (
      await orders()
    ).updateOne(
      { _id: orderId, status: "pending" },
      { $set: { status: "failed", updatedAt: now }, $unset: { idempotencyKey: "" } },
    );
  },

  async openCheckout(order, now) {
    const [collection, client] = await Promise.all([orders(), getMongoClient()]);
    const { id, ...fields } = order;
    let superseded: Order[] = [];
    try {
      await client.withSession((session) =>
        session.withTransaction(async () => {
          const open = await collection
            .find({ giftId: order.giftId, status: "pending" }, { session })
            .toArray();
          if (open.length > 0) {
            await collection.updateMany(
              { _id: { $in: open.map((document) => document._id) }, status: "pending" },
              { $set: { status: "cancelled", updatedAt: now } },
              { session },
            );
          }
          await collection.insertOne({ _id: id, ...fields }, { session });
          // The provider's verdict once the link has expired, whatever the browser does.
          await enqueueJob(
            await getDatabase(),
            {
              availableAt: new Date(
                order.expiresAt.getTime() + PAYMENT_RECONCILE_DELAY_MILLISECONDS,
              ),
              deduplicationKey: `${PAYMENT_RECONCILE_JOB}:${id}`,
              now,
              payload: { orderId: id },
              type: PAYMENT_RECONCILE_JOB,
            },
            session,
          );
          superseded = open.map(toOrder);
        }),
      );
    } catch (error) {
      const index = duplicateKeyIndex(error);
      if (index === "key") return { kind: "key-taken" };
      if (index === "gift") return { kind: "gift-busy" };
      throw error;
    }
    return { kind: "created", superseded };
  },
};

/** The gift's `paid` order not yet fulfilled, oldest payment first (`gift-publishing`). */
export async function findPaidOrderForGift(giftId: string): Promise<Order | null> {
  const document = await (
    await orders()
  ).findOne({ giftId, status: "paid" }, { sort: { paidAt: 1 } });
  return document ? toOrder(document) : null;
}

/** The owner's paid, unfulfilled order of a gift, for the Studio's plan offers. */
export async function findPaidOrderForOwnerGift(
  giftPublicId: string,
  ownerId: string,
): Promise<Order | null> {
  const document = await (
    await orders()
  ).findOne({ giftPublicId, ownerId, status: "paid" }, { sort: { paidAt: 1 } });
  return document ? toOrder(document) : null;
}

type PaymentAttemptDocument = Readonly<{
  _id: string;
  amountVnd: number;
  currency: string;
  orderId: string | null;
  outcome: string;
  provider: string;
  receivedAt: Date;
  source: string;
}>;

/** Support lookup (`billing-checkout` "Admin order lookup"): exact identifiers only. */
export const mongoAdminOrderLookup: AdminOrderLookupRepository = {
  async findAttempts(orderIds) {
    if (orderIds.length === 0) return [];
    const documents = await (
      await getDatabase()
    )
      .collection<PaymentAttemptDocument>(COLLECTIONS.paymentAttempts)
      .find({ orderId: { $in: [...orderIds] } }, { sort: { receivedAt: -1 } })
      .limit(100)
      .toArray();
    // The `_id` holds the provider's reference: never shown.
    return documents.map(({ _id, ...attempt }) => attempt);
  },

  async findOrders({ text }, limit) {
    const code = /^\d{12}$/.test(text) ? Number(text) : null;
    const documents = await (
      await orders()
    )
      .find({
        $or: [{ _id: text }, { giftPublicId: text }, ...(code ? [{ orderCode: code }] : [])],
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    return documents.map(toOrder);
  },
};
