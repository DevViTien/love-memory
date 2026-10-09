import "server-only";

import { COLLECTIONS, enqueueJob, getDatabase, getMongoClient } from "@love-memory/database";
import { type OrderStatus } from "@love-memory/domain";
import { MongoServerError } from "mongodb";

import { systemEmailJob } from "@/modules/notifications/application/system-emails";

import {
  type PaymentOutcome,
  type PaymentRepository,
  PUBLISH_FINALIZE_JOB,
} from "../application/payments";

type OrderDocument = Readonly<{
  _id: string;
  amountVnd: number;
  currency: string;
  giftId: string;
  orderCode: number;
  provider: string;
  status: OrderStatus;
}>;

type PaymentAttemptDocument = Readonly<{
  _id: string;
  amountVnd: number;
  createdAt: Date;
  currency: string;
  orderCode: number;
  orderId: string | null;
  outcome: Exclude<PaymentOutcome, "duplicate">;
  provider: string;
  receivedAt: Date;
  source: string;
}>;

/** A verified payment may still close an order the server closed first (`ORDER_TRANSITIONS`). */
const PAYABLE: readonly OrderStatus[] = ["pending", "cancelled", "expired"];

/** `paymentAttempts` and `orders` (`billing-checkout` "Payment application"). */
export const mongoPaymentRepository: PaymentRepository = {
  async apply(payment, now) {
    const [database, client] = await Promise.all([getDatabase(), getMongoClient()]);
    const orders = database.collection<OrderDocument>(COLLECTIONS.orders);
    const attempts = database.collection<PaymentAttemptDocument>(COLLECTIONS.paymentAttempts);
    let outcome: PaymentOutcome = "unknown_order";
    try {
      await client.withSession((session) =>
        session.withTransaction(async () => {
          const order = await orders.findOne(
            { orderCode: payment.orderCode, provider: payment.provider },
            { session },
          );
          if (!order) {
            outcome = "unknown_order";
          } else if (payment.amountVnd !== order.amountVnd || payment.currency !== "VND") {
            outcome = "amount_mismatch";
          } else if (PAYABLE.includes(order.status)) {
            const paid = await orders.updateOne(
              { _id: order._id, status: { $in: [...PAYABLE] } },
              {
                $set: {
                  paidAt: now,
                  paymentReference: payment.reference,
                  status: "paid",
                  updatedAt: now,
                },
              },
              { session },
            );
            if (paid.modifiedCount !== 1) throw new Error("Order changed during payment.");
            await enqueueJob(
              database,
              {
                deduplicationKey: `${PUBLISH_FINALIZE_JOB}:${order._id}`,
                now,
                payload: { orderId: order._id },
                type: PUBLISH_FINALIZE_JOB,
              },
              session,
            );
            await enqueueJob(
              database,
              systemEmailJob(
                { eventKey: order._id, giftId: order.giftId, kind: "payment_received" },
                now,
              ),
              session,
            );
            outcome = "applied";
          } else {
            outcome = "already_paid";
          }
          // Last: a duplicate reference aborts the whole transaction, writes included.
          await attempts.insertOne(
            {
              _id: `${payment.provider}:${payment.reference}`,
              amountVnd: payment.amountVnd,
              createdAt: now,
              currency: payment.currency,
              orderCode: payment.orderCode,
              orderId: order?._id ?? null,
              outcome,
              provider: payment.provider,
              receivedAt: now,
              source: payment.source,
            },
            { session },
          );
        }),
      );
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) return "duplicate";
      throw error;
    }
    return outcome;
  },
};
