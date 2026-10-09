import type * as DatabaseModule from "@love-memory/database";
import { MongoServerError } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn(), getMongoClient: vi.fn() }));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
  getMongoClient: databaseMocks.getMongoClient,
}));

import { type StoredOrder } from "../application/checkout-service";
import {
  findPaidOrderForGift,
  findPaidOrderForOwnerGift,
  mongoAdminOrderLookup,
  mongoOrderRepository,
} from "./mongo-order-repository";

const now = new Date("2026-10-10T10:00:00.000Z");
const orderId = "0b3c5a7e-1f1c-4b8e-9a51-6c0f2d7e8a90";
const giftId = "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89";

const order: StoredOrder = {
  amountVnd: 49_000,
  checkoutUrl: null,
  createdAt: now,
  currency: "VND",
  expiresAt: new Date("2026-10-10T10:15:00.000Z"),
  giftId,
  giftPublicId: "pub-1",
  id: orderId,
  idempotencyKey: "key-1",
  orderCode: 123_456_789_012,
  ownerId: "user-1",
  planId: "standard",
  planVersion: 1,
  provider: "fake",
  providerPaymentId: null,
  requestFingerprint: "[]",
  revision: 5,
  rightsConfirmedAt: now,
  status: "pending",
  updatedAt: now,
};
const { id: _id, ...fields } = order;
const document = { _id: orderId, ...fields };

function duplicateKey(keyPattern: Record<string, number>) {
  const error = new MongoServerError({ code: 11000, errmsg: "E11000 duplicate key" });
  Object.assign(error, { keyPattern });
  return error;
}

describe("Mongo order repository", () => {
  const collection = {
    find: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    insertOne: vi.fn(),
    updateMany: vi.fn(),
    updateOne: vi.fn(),
  };
  const session = { id: "session" };

  beforeEach(() => {
    vi.resetAllMocks();
    databaseMocks.getDatabase.mockResolvedValue({ collection: () => collection });
    databaseMocks.getMongoClient.mockResolvedValue({
      withSession: (work: (value: unknown) => Promise<void>) =>
        work({ ...session, withTransaction: (transaction: () => Promise<void>) => transaction() }),
    });
    collection.find.mockReturnValue({ toArray: () => Promise.resolve([]) });
  });

  it("closes the gift's pending orders and inserts the new one in one transaction", async () => {
    const older = { ...document, _id: "1d1b1c1a-0000-4000-8000-000000000001", orderCode: 1e11 };
    collection.find.mockReturnValueOnce({ toArray: () => Promise.resolve([older]) });

    await expect(mongoOrderRepository.openCheckout(order, now)).resolves.toEqual({
      kind: "created",
      superseded: [expect.objectContaining({ id: older._id, status: "pending" })],
    });
    expect(collection.find).toHaveBeenCalledWith(
      { giftId, status: "pending" },
      { session: expect.anything() as unknown },
    );
    expect(collection.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [older._id] }, status: "pending" },
      { $set: { status: "cancelled", updatedAt: now } },
      { session: expect.anything() as unknown },
    );
    expect(collection.insertOne).toHaveBeenCalledWith(document, {
      session: expect.anything() as unknown,
    });
    // The reconciliation runs two minutes after the link expires, whatever the browser does.
    expect(collection.updateOne).toHaveBeenCalledWith(
      { deduplicationKey: `payment.reconcile.v1:${orderId}` },
      {
        $setOnInsert: expect.objectContaining({
          availableAt: new Date("2026-10-10T10:17:00.000Z"),
          payload: { orderId },
          type: "payment.reconcile.v1",
        }) as object,
      },
      { session: expect.anything() as unknown, upsert: true },
    );
  });

  it("reports a taken key or a concurrent pending order, and rethrows anything else", async () => {
    collection.insertOne.mockRejectedValueOnce(duplicateKey({ idempotencyKey: 1, ownerId: 1 }));
    await expect(mongoOrderRepository.openCheckout(order, now)).resolves.toEqual({
      kind: "key-taken",
    });
    collection.insertOne.mockRejectedValueOnce(duplicateKey({ giftId: 1 }));
    await expect(mongoOrderRepository.openCheckout(order, now)).resolves.toEqual({
      kind: "gift-busy",
    });
    collection.insertOne.mockRejectedValueOnce(duplicateKey({ orderCode: 1 }));
    await expect(mongoOrderRepository.openCheckout(order, now)).rejects.toBeInstanceOf(
      MongoServerError,
    );
    expect(collection.updateMany).not.toHaveBeenCalled();
  });

  it("attaches the link and closes only a pending order", async () => {
    collection.findOneAndUpdate.mockResolvedValueOnce({
      ...document,
      checkoutUrl: "https://pay.example/1",
      providerPaymentId: "p1",
    });
    await expect(
      mongoOrderRepository.attachPaymentLink(
        orderId,
        { checkoutUrl: "https://pay.example/1", providerPaymentId: "p1" },
        now,
      ),
    ).resolves.toMatchObject({ checkoutUrl: "https://pay.example/1", id: orderId });
    expect(collection.findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: orderId, status: "pending" },
      {
        $set: { checkoutUrl: "https://pay.example/1", providerPaymentId: "p1", updatedAt: now },
      },
      { returnDocument: "after" },
    );

    collection.findOneAndUpdate.mockResolvedValueOnce(null);
    await expect(mongoOrderRepository.closePending(orderId, "expired", now)).resolves.toBeNull();
    expect(collection.findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: orderId, status: "pending" },
      { $set: { status: "expired", updatedAt: now } },
      { returnDocument: "after" },
    );
    collection.findOneAndUpdate.mockResolvedValueOnce(null);
    await expect(
      mongoOrderRepository.attachPaymentLink(
        orderId,
        { checkoutUrl: "https://pay.example/1", providerPaymentId: "p1" },
        now,
      ),
    ).resolves.toBeNull();
    collection.findOneAndUpdate.mockResolvedValueOnce({ ...document, status: "cancelled" });
    await expect(
      mongoOrderRepository.closePending(orderId, "cancelled", now),
    ).resolves.toMatchObject({ status: "cancelled" });
  });

  it("fails an order and releases its key", async () => {
    await mongoOrderRepository.markFailed(orderId, now);
    expect(collection.updateOne).toHaveBeenCalledWith(
      { _id: orderId, status: "pending" },
      { $set: { status: "failed", updatedAt: now }, $unset: { idempotencyKey: "" } },
    );
  });

  it("reads by owner and key, or by id within the owner's orders", async () => {
    collection.findOne.mockResolvedValueOnce(document).mockResolvedValueOnce(null);
    await expect(mongoOrderRepository.findByIdempotencyKey("user-1", "key-1")).resolves.toEqual(
      order,
    );
    expect(collection.findOne).toHaveBeenLastCalledWith({
      idempotencyKey: "key-1",
      ownerId: "user-1",
    });
    await expect(mongoOrderRepository.findForOwner(orderId, "user-2")).resolves.toBeNull();
    expect(collection.findOne).toHaveBeenLastCalledWith({ _id: orderId, ownerId: "user-2" });

    const { idempotencyKey: _key, ...released } = document;
    collection.findOne.mockResolvedValueOnce(released);
    await expect(mongoOrderRepository.findByIdempotencyKey("user-1", "x")).resolves.toMatchObject({
      idempotencyKey: null,
    });
    collection.findOne.mockResolvedValueOnce(document);
    const read = await mongoOrderRepository.findForOwner(orderId, "user-1");
    expect(read).not.toHaveProperty("requestFingerprint");
    expect(read).not.toHaveProperty("idempotencyKey");
  });

  it("reads any order by id, and a gift's paid order oldest payment first", async () => {
    collection.findOne
      .mockResolvedValueOnce(document)
      .mockResolvedValueOnce({ ...document, paidAt: now, status: "paid" })
      .mockResolvedValueOnce(null);
    await expect(mongoOrderRepository.findById(orderId)).resolves.toMatchObject({ id: orderId });
    await expect(findPaidOrderForGift(giftId)).resolves.toMatchObject({ status: "paid" });
    expect(collection.findOne).toHaveBeenLastCalledWith(
      { giftId, status: "paid" },
      { sort: { paidAt: 1 } },
    );
    await expect(findPaidOrderForOwnerGift("pub-1", "user-1")).resolves.toBeNull();
    expect(collection.findOne).toHaveBeenLastCalledWith(
      { giftPublicId: "pub-1", ownerId: "user-1", status: "paid" },
      { sort: { paidAt: 1 } },
    );
  });

  it("looks orders up by exact id, order code or gift, and hides payment references", async () => {
    const cursor = {
      limit: vi.fn(() => cursor),
      sort: vi.fn(() => cursor),
      toArray: vi.fn(() => Promise.resolve([document])),
    };
    collection.find.mockReturnValueOnce(cursor);
    await expect(mongoAdminOrderLookup.findOrders({ text: "123456789012" }, 20)).resolves.toEqual([
      expect.objectContaining({ id: orderId }),
    ]);
    expect(collection.find).toHaveBeenLastCalledWith({
      $or: [
        { _id: "123456789012" },
        { giftPublicId: "123456789012" },
        { orderCode: 123_456_789_012 },
      ],
    });
    expect(cursor.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(cursor.limit).toHaveBeenCalledWith(20);

    collection.find.mockReturnValueOnce({ ...cursor, toArray: () => Promise.resolve([]) });
    await mongoAdminOrderLookup.findOrders({ text: "pub-1" }, 20);
    expect(collection.find).toHaveBeenLastCalledWith({
      $or: [{ _id: "pub-1" }, { giftPublicId: "pub-1" }],
    });

    const attempts = {
      limit: vi.fn(() => attempts),
      toArray: vi.fn(() =>
        Promise.resolve([
          {
            _id: "payos:TF1",
            amountVnd: 49_000,
            currency: "VND",
            orderId,
            outcome: "applied",
            provider: "payos",
            receivedAt: now,
            source: "webhook",
          },
        ]),
      ),
    };
    collection.find.mockReturnValueOnce(attempts);
    const found = await mongoAdminOrderLookup.findAttempts([orderId]);
    expect(found).toEqual([
      {
        amountVnd: 49_000,
        currency: "VND",
        orderId,
        outcome: "applied",
        provider: "payos",
        receivedAt: now,
        source: "webhook",
      },
    ]);
    await expect(mongoAdminOrderLookup.findAttempts([])).resolves.toEqual([]);
  });
});
