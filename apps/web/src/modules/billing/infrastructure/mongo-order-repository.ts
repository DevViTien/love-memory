import "server-only";

import { COLLECTIONS, getDatabase, getMongoClient } from "@love-memory/database";
import { type Order, OrderSchema } from "@love-memory/domain";
import { MongoServerError } from "mongodb";

import { type OrderRepository, type StoredOrder } from "../application/checkout-service";

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
