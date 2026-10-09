import type * as DatabaseModule from "@love-memory/database";
import { MongoServerError } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn(), getMongoClient: vi.fn() }));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
  getMongoClient: databaseMocks.getMongoClient,
}));

import { type VerifiedPayment } from "../application/payments";
import { mongoPaymentRepository } from "./mongo-payment-repository";

const now = new Date("2026-10-10T10:00:00.000Z");
const orderId = "0b3c5a7e-1f1c-4b8e-9a51-6c0f2d7e8a90";
const giftId = "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89";
const payment: VerifiedPayment = {
  amountVnd: 49_000,
  currency: "VND",
  orderCode: 123_456_789_012,
  provider: "payos",
  reference: "TF1",
  source: "webhook",
};
const order = {
  _id: orderId,
  amountVnd: 49_000,
  currency: "VND",
  giftId,
  orderCode: 123_456_789_012,
  provider: "payos",
  status: "pending",
};

describe("Mongo payment repository", () => {
  const collections = {
    jobOutbox: { updateOne: vi.fn() },
    orders: { findOne: vi.fn(), updateOne: vi.fn() },
    paymentAttempts: { insertOne: vi.fn() },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: keyof typeof collections) => collections[name],
    });
    databaseMocks.getMongoClient.mockResolvedValue({
      withSession: (work: (value: unknown) => Promise<void>) =>
        work({ withTransaction: (transaction: () => Promise<void>) => transaction() }),
    });
    collections.orders.updateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  it("marks a pending order paid, enqueues fulfillment and the email, and records the payment (Payment applied)", async () => {
    collections.orders.findOne.mockResolvedValueOnce(order);

    await expect(mongoPaymentRepository.apply(payment, now)).resolves.toBe("applied");
    expect(collections.orders.findOne).toHaveBeenCalledWith(
      { orderCode: 123_456_789_012, provider: "payos" },
      expect.anything(),
    );
    expect(collections.orders.updateOne).toHaveBeenCalledWith(
      { _id: orderId, status: { $in: ["pending", "cancelled", "expired"] } },
      { $set: { paidAt: now, paymentReference: "TF1", status: "paid", updatedAt: now } },
      expect.anything(),
    );
    const keys = collections.jobOutbox.updateOne.mock.calls.map(
      ([filter]) => (filter as { deduplicationKey: string }).deduplicationKey,
    );
    expect(keys).toEqual([
      `publish.finalize.v1:${orderId}`,
      `email.send.v1:payment_received:${giftId}:${orderId}`,
    ]);
    expect(collections.paymentAttempts.insertOne).toHaveBeenCalledWith(
      {
        _id: "payos:TF1",
        amountVnd: 49_000,
        createdAt: now,
        currency: "VND",
        orderCode: 123_456_789_012,
        orderId,
        outcome: "applied",
        provider: "payos",
        receivedAt: now,
        source: "webhook",
      },
      expect.anything(),
    );
  });

  it("pays a closed order too: a verified payment beats the local closing", async () => {
    collections.orders.findOne.mockResolvedValueOnce({ ...order, status: "expired" });
    await expect(mongoPaymentRepository.apply(payment, now)).resolves.toBe("applied");
  });

  it("records a mismatch, an unknown order or an already paid order without changing it", async () => {
    collections.orders.findOne
      .mockResolvedValueOnce({ ...order, amountVnd: 99_000 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...order, status: "fulfilled" });

    await expect(mongoPaymentRepository.apply(payment, now)).resolves.toBe("amount_mismatch");
    await expect(mongoPaymentRepository.apply(payment, now)).resolves.toBe("unknown_order");
    await expect(mongoPaymentRepository.apply(payment, now)).resolves.toBe("already_paid");
    await expect(mongoPaymentRepository.apply({ ...payment, currency: "USD" }, now)).resolves.toBe(
      "unknown_order",
    );

    expect(collections.orders.updateOne).not.toHaveBeenCalled();
    expect(collections.jobOutbox.updateOne).not.toHaveBeenCalled();
    expect(
      collections.paymentAttempts.insertOne.mock.calls.map(
        ([document]) => (document as { outcome: string }).outcome,
      ),
    ).toEqual(["amount_mismatch", "unknown_order", "already_paid", "unknown_order"]);
  });

  it("answers duplicate for a reference already recorded, and rethrows other errors (Duplicate webhook)", async () => {
    collections.orders.findOne.mockResolvedValue(order);
    collections.paymentAttempts.insertOne.mockRejectedValueOnce(
      new MongoServerError({ code: 11000, errmsg: "E11000" }),
    );
    await expect(mongoPaymentRepository.apply(payment, now)).resolves.toBe("duplicate");

    collections.paymentAttempts.insertOne.mockRejectedValueOnce(new Error("network"));
    await expect(mongoPaymentRepository.apply(payment, now)).rejects.toThrow("network");

    collections.orders.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });
    await expect(mongoPaymentRepository.apply(payment, now)).rejects.toThrow(
      "Order changed during payment.",
    );
  });
});
