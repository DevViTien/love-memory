import { COLLECTIONS } from "@love-memory/database";
import type * as DatabaseModule from "@love-memory/database";
import { UUID } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
}));

import { mongoSystemEmailRecipients } from "./mongo-system-email-recipients";

const giftId = "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89";
const ownerId = "0b3c5a7e-1f1c-4b8e-9a51-6c0f2d7e8a90";

describe("Mongo system email recipients", () => {
  const gifts = { findOne: vi.fn() };
  const users = { findOne: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) => (name === COLLECTIONS.gifts ? gifts : users),
    });
  });

  it("reads the gift unless it is being deleted, then its owner's address by either id form", async () => {
    gifts.findOne.mockResolvedValueOnce({
      _id: giftId,
      ownership: { ownerId },
      publicId: "pub-1",
      status: "published",
    });
    users.findOne.mockResolvedValueOnce({ email: "owner@example.test" });

    await expect(mongoSystemEmailRecipients.findForGift(giftId)).resolves.toEqual({
      email: "owner@example.test",
      publicId: "pub-1",
    });
    expect(gifts.findOne).toHaveBeenCalledWith(
      { _id: giftId, status: { $ne: "deleting" } },
      expect.objectContaining({ projection: expect.any(Object) as object }),
    );
    expect(users.findOne).toHaveBeenCalledWith(
      { _id: { $in: [new UUID(ownerId), ownerId] } },
      { projection: { _id: 0, email: 1 } },
    );
  });

  it("answers null for a gone gift or an anonymous one, and a null address for a gone owner", async () => {
    gifts.findOne.mockResolvedValueOnce(null);
    await expect(mongoSystemEmailRecipients.findForGift(giftId)).resolves.toBeNull();

    gifts.findOne.mockResolvedValueOnce({
      _id: giftId,
      ownership: { ownerId: null },
      publicId: "pub-1",
      status: "published",
    });
    await expect(mongoSystemEmailRecipients.findForGift(giftId)).resolves.toBeNull();
    expect(users.findOne).not.toHaveBeenCalled();

    gifts.findOne.mockResolvedValueOnce({
      _id: giftId,
      ownership: { ownerId },
      publicId: "pub-1",
      status: "paused",
    });
    users.findOne.mockResolvedValueOnce(null);
    await expect(mongoSystemEmailRecipients.findForGift(giftId)).resolves.toEqual({
      email: null,
      publicId: "pub-1",
    });
  });
});
