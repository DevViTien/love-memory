import type * as DatabaseModule from "@love-memory/database";
import { UUID } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
}));

import { mongoAdminGiftLookup } from "./mongo-admin-gift-lookup";

const giftId = "8a0c1c1e-1111-4111-8111-111111111111";

function giftDocument(ownerId: string | null) {
  return {
    _id: giftId,
    content: { templateId: "memory-box", templateVersion: "1.0.0" },
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    entitlement: { planId: "standard" },
    expiresAt: new Date("2027-10-01T00:00:00.000Z"),
    ownership: { ownerId },
    publicId: "abcDEF123456",
    publishedAt: new Date("2026-10-02T00:00:00.000Z"),
    publishedRevision: 2,
    revision: 3,
    status: "published",
    updatedAt: new Date("2026-10-03T00:00:00.000Z"),
  };
}

describe("Mongo admin gift lookup", () => {
  const gifts = { findOne: vi.fn() };
  const users = { findOne: vi.fn() };
  const assets = { aggregate: vi.fn() };
  const giftTombstones = { findOne: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) => ({ assets, giftTombstones, gifts, users })[name],
    });
    assets.aggregate.mockReturnValue({
      toArray: () =>
        Promise.resolve([
          { _id: "ready", count: 2 },
          { _id: "failed", count: 1 },
        ]),
    });
  });

  it("matches exactly one of the three identifiers and reads no content", async () => {
    gifts.findOne.mockResolvedValueOnce(null);

    await expect(mongoAdminGiftLookup.findSummary("q-1")).resolves.toBeNull();

    const [filter, options] = gifts.findOne.mock.calls[0] as [unknown, { projection: object }];
    expect(filter).toEqual({
      $or: [{ _id: "q-1" }, { publicId: "q-1" }, { shareId: { $eq: "q-1", $type: "string" } }],
    });
    expect(Object.keys(options.projection)).not.toContain("content");
    expect(Object.keys(options.projection)).not.toContain("content.data");
    expect(Object.keys(options.projection)).not.toContain("shareId");
    expect(users.findOne).not.toHaveBeenCalled();
  });

  it("returns exactly the summary fields, the owner email and the asset counts (Lookup by public id)", async () => {
    gifts.findOne.mockResolvedValueOnce(giftDocument("user-1"));
    users.findOne.mockResolvedValueOnce({ email: "owner@example.test" });

    const summary = await mongoAdminGiftLookup.findSummary("abcDEF123456");

    expect(Object.keys(summary ?? {}).sort()).toEqual([
      "assetCounts",
      "createdAt",
      "expiresAt",
      "id",
      "owner",
      "planId",
      "publicId",
      "publishedAt",
      "publishedRevision",
      "revision",
      "status",
      "templateId",
      "templateVersion",
      "updatedAt",
    ]);
    expect(summary).toMatchObject({
      assetCounts: { failed: 1, ready: 2 },
      id: giftId,
      owner: { email: "owner@example.test", id: "user-1", kind: "user" },
      planId: "standard",
      publishedRevision: 2,
      revision: 3,
      status: "published",
      templateId: "memory-box",
      templateVersion: "1.0.0",
    });
    expect(users.findOne).toHaveBeenCalledWith(
      { _id: { $in: ["user-1"] } },
      { projection: { _id: 0, email: 1 } },
    );
    expect(assets.aggregate).toHaveBeenCalledWith([
      { $match: { giftId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
  });

  it("labels an anonymous draft and fills missing publication fields with null", async () => {
    gifts.findOne.mockResolvedValueOnce({
      ...giftDocument(null),
      entitlement: undefined,
      expiresAt: undefined,
      publishedAt: undefined,
      publishedRevision: undefined,
      status: "draft",
    });

    await expect(mongoAdminGiftLookup.findSummary(giftId)).resolves.toMatchObject({
      expiresAt: null,
      owner: { kind: "anonymous" },
      planId: null,
      publishedAt: null,
      publishedRevision: null,
    });
    expect(users.findOne).not.toHaveBeenCalled();
  });

  it("finds an owner stored by Better Auth under a UUID", async () => {
    const ownerId = "8b869789-7d9f-474b-ba36-da954357c79d";
    gifts.findOne.mockResolvedValueOnce(giftDocument(ownerId));
    users.findOne.mockResolvedValueOnce({ email: "owner@example.test" });

    await mongoAdminGiftLookup.findSummary(giftId);

    const [filter] = users.findOne.mock.calls[0] as [{ _id: { $in: unknown[] } }];
    expect(filter._id.$in).toEqual([new UUID(ownerId), ownerId]);
  });

  it("keeps the owner id when the user record is gone", async () => {
    gifts.findOne.mockResolvedValueOnce(giftDocument("user-gone"));
    users.findOne.mockResolvedValueOnce(null);

    await expect(mongoAdminGiftLookup.findSummary(giftId)).resolves.toMatchObject({
      owner: { email: null, id: "user-gone", kind: "user" },
    });
  });

  it("finds a tombstone by id or public id and returns only its ids and times", async () => {
    const deletedAt = new Date("2026-10-10T12:00:00.000Z");
    giftTombstones.findOne.mockResolvedValueOnce({
      _id: giftId,
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
      deletedAt,
      deletionRequestedAt: new Date("2026-10-10T11:00:00.000Z"),
      ownerId: null,
      publicId: "abcDEF123456",
      publishedAt: null,
    });

    const tombstone = await mongoAdminGiftLookup.findTombstone("abcDEF123456");

    expect(giftTombstones.findOne).toHaveBeenCalledWith(
      { $or: [{ _id: "abcDEF123456" }, { publicId: "abcDEF123456" }] },
      expect.anything(),
    );
    expect(Object.keys(tombstone ?? {}).sort()).toEqual([
      "createdAt",
      "deletedAt",
      "deletionRequestedAt",
      "id",
      "ownerId",
      "publicId",
      "publishedAt",
    ]);
    expect(tombstone).toMatchObject({ deletedAt, id: giftId, ownerId: null });

    giftTombstones.findOne.mockResolvedValueOnce(null);
    await expect(mongoAdminGiftLookup.findTombstone("nothing")).resolves.toBeNull();
  });
});
