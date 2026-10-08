import { COLLECTIONS, LEGACY_ENTITLEMENT } from "@love-memory/database";
import type * as DatabaseModule from "@love-memory/database";
import {
  createGiftDraft,
  createGiftPublication,
  currentPlan,
  grantEntitlement,
  publishGiftDraft,
  republishGift,
  updateGiftDraft,
} from "@love-memory/domain";
import { MongoServerError } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  getMongoClient: vi.fn(),
}));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
  getMongoClient: databaseMocks.getMongoClient,
}));

import { mongoGiftRepository } from "./mongo-gift-repository";

type StoredDocument = Record<string, unknown> & { _id: string };

function valueAtPath(document: StoredDocument, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)[key]
      : undefined;
  }, document);
}

/** Equality plus the `$in` operator the editable-status filters use. */
function matches(document: StoredDocument, filter: Readonly<Record<string, unknown>>): boolean {
  return Object.entries(filter).every(([key, value]) => {
    const actual = valueAtPath(document, key);
    if (typeof value === "object" && value !== null && "$in" in value) {
      return (value as { $in: readonly unknown[] }).$in.includes(actual);
    }
    return actual === value;
  });
}

class GiftCollection {
  documents: StoredDocument[] = [];

  findOne(filter: Readonly<Record<string, unknown>>) {
    return Promise.resolve(this.documents.find((document) => matches(document, filter)) ?? null);
  }

  findOneAndUpdate(
    filter: Readonly<Record<string, unknown>>,
    update: Readonly<{
      $inc?: Readonly<Record<string, number>>;
      $set?: Readonly<Record<string, unknown>>;
    }>,
  ) {
    const document = this.documents.find((candidate) => matches(candidate, filter));
    if (!document) {
      return Promise.resolve(null);
    }

    Object.assign(document, update.$set);
    for (const [key, increment] of Object.entries(update.$inc ?? {})) {
      document[key] = Number(document[key]) + increment;
    }
    return Promise.resolve(document);
  }

  insertOne(document: StoredDocument) {
    this.documents.push(document);
    return Promise.resolve({ insertedId: document._id });
  }

  /** Supports the revision pruning filter: equality plus `{ revision: { $lt } }`. */
  deleteMany(filter: Readonly<{ giftId: string; revision: Readonly<{ $lt: number }> }>) {
    const before = this.documents.length;
    this.documents = this.documents.filter(
      (document) =>
        document["giftId"] !== filter.giftId || Number(document["revision"]) >= filter.revision.$lt,
    );
    return Promise.resolve({ deletedCount: before - this.documents.length });
  }
}

describe("Mongo gift repository", () => {
  const gifts = new GiftCollection();
  const revisions = new GiftCollection();
  const idempotencyKeys = new GiftCollection();
  const draft = createGiftDraft({
    anonymousDraftId: "2f7d675f-55d2-4e4b-b017-b0e0f9277ac2",
    claimTokenHash: "a".repeat(64),
    content: {
      data: {},
      schemaVersion: 1,
      templateId: "memory-box",
      templateVersion: "1.0.0",
    },
    id: "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
    now: new Date("2026-09-16T00:00:00.000Z"),
    ownerId: null,
    publicId: "q1w2e3r4t5y6u7i8",
  });
  const idempotency = {
    accessor: {
      anonymousDraftId: draft.ownership.anonymousDraftId!,
      claimTokenHash: draft.ownership.claimTokenHash!,
      kind: "anonymous" as const,
    },
    actorKey: `anonymous:${draft.ownership.anonymousDraftId}`,
    expiresAt: new Date("2026-09-17T00:00:00.000Z"),
    key: "4449d41a-6750-43c1-8dc4-b567ebb20cf2",
    requestFingerprint: JSON.stringify(["memory-box", "1.0.0"]),
    scope: "gift-create" as const,
  };

  beforeEach(() => {
    gifts.documents = [];
    revisions.documents = [];
    idempotencyKeys.documents = [];
    databaseMocks.getDatabase.mockReset();
    databaseMocks.getMongoClient.mockReset();
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) =>
        name === COLLECTIONS.gifts
          ? gifts
          : name === COLLECTIONS.giftRevisions
            ? revisions
            : idempotencyKeys,
    });
    databaseMocks.getMongoClient.mockResolvedValue({
      withSession: async (operation: (session: unknown) => Promise<void>) =>
        operation({ withTransaction: (transaction: () => Promise<void>) => transaction() }),
    });
  });

  it("reads a gift by id only while its content is editable", async () => {
    const findOne = vi.spyOn(gifts, "findOne");
    await mongoGiftRepository.createDraft(draft, idempotency);

    await expect(mongoGiftRepository.findEditableById(draft.id)).resolves.toMatchObject({
      id: draft.id,
      publicId: draft.publicId,
    });
    expect(findOne).toHaveBeenLastCalledWith({
      _id: draft.id,
      status: { $in: ["draft", "published"] },
    });

    gifts.documents[0]!["status"] = "paused";
    await expect(mongoGiftRepository.findEditableById(draft.id)).resolves.toBeNull();
    await expect(mongoGiftRepository.findEditableById("missing")).resolves.toBeNull();
    findOne.mockRestore();
  });

  it("saves the working copy of a published gift and reads a legacy one with its pointer", async () => {
    const owner = { kind: "user" as const, userId: "owner-1" };
    gifts.documents.push({
      _id: draft.id,
      access: { mode: "unlisted" },
      content: draft.content,
      createdAt: draft.createdAt,
      ownership: { anonymousDraftId: null, claimTokenHash: null, ownerId: "owner-1" },
      publicId: draft.publicId,
      publishedAt: draft.createdAt,
      // Published before `publishedRevision` existed: no pointer until `db:migrate`.
      revision: 0,
      shareId: "Ab0_-cdefghijklmnopqrs",
      status: "published",
      updatedAt: draft.createdAt,
    });

    const legacy = await mongoGiftRepository.findAuthorized(draft.publicId, [owner]);
    expect(legacy).toMatchObject({ publishedRevision: 0, revision: 0, status: "published" });
    // Published before plans existed: read with the entitlement the schema 11 backfill writes.
    expect(legacy?.entitlement).toEqual({ ...LEGACY_ENTITLEMENT, grantedAt: draft.createdAt });
    expect(legacy?.expiresAt).toEqual(new Date(draft.createdAt.getTime() + 365 * 86_400_000));

    const updated = updateGiftDraft(legacy!, {
      content: { ...draft.content, data: { headline: "Sửa sau khi gửi" } },
      expectedRevision: 0,
      now: new Date("2026-09-16T01:00:00.000Z"),
    });
    if (!updated.ok) throw new Error("Expected the working copy to save.");
    await expect(mongoGiftRepository.updateDraft(updated.data, 0, [owner])).resolves.toMatchObject({
      publishedRevision: 0,
      revision: 1,
      status: "published",
    });
  });

  it("creates the initial immutable revision and enforces anonymous access", async () => {
    await expect(mongoGiftRepository.createDraft(draft, idempotency)).resolves.toMatchObject({
      status: "created",
    });

    await expect(
      mongoGiftRepository.findAuthorized(draft.publicId, [
        {
          anonymousDraftId: draft.ownership.anonymousDraftId!,
          claimTokenHash: draft.ownership.claimTokenHash!,
          kind: "anonymous",
        },
      ]),
    ).resolves.toMatchObject({ publicId: draft.publicId });
    await expect(
      mongoGiftRepository.findAuthorized(draft.publicId, [
        {
          kind: "user",
          userId: "other-user",
        },
      ]),
    ).resolves.toBeNull();
    expect(revisions.documents).toHaveLength(1);
  });

  it("updates atomically only for the authorized expected revision", async () => {
    await mongoGiftRepository.createDraft(draft, idempotency);
    const updated = updateGiftDraft(draft, {
      content: { ...draft.content, data: { headline: "Our story" } },
      expectedRevision: 0,
      now: new Date("2026-09-16T01:00:00.000Z"),
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) {
      throw new Error("Expected draft update to succeed.");
    }
    const accessor = {
      anonymousDraftId: draft.ownership.anonymousDraftId!,
      claimTokenHash: draft.ownership.claimTokenHash!,
      kind: "anonymous" as const,
    };

    await expect(
      mongoGiftRepository.updateDraft(updated.data, 0, [accessor]),
    ).resolves.toMatchObject({
      revision: 1,
    });
    await expect(mongoGiftRepository.updateDraft(updated.data, 0, [accessor])).resolves.toBeNull();
    expect(revisions.documents).toHaveLength(2);
  });

  it("keeps only the 20 most recent revision snapshots of a gift (Older snapshots pruned)", async () => {
    await mongoGiftRepository.createDraft(draft, idempotency);
    const accessor = {
      anonymousDraftId: draft.ownership.anonymousDraftId!,
      claimTokenHash: draft.ownership.claimTokenHash!,
      kind: "anonymous" as const,
    };
    const otherGift = { _id: "other-gift:0", giftId: "other-gift", revision: 0 };
    revisions.documents.push(otherGift);

    let current = draft;
    for (let revision = 0; revision < 25; revision += 1) {
      const updated = updateGiftDraft(current, {
        content: { ...current.content, data: { headline: `Story ${revision}` } },
        expectedRevision: revision,
        now: new Date("2026-09-16T01:00:00.000Z"),
      });
      if (!updated.ok) throw new Error("Expected draft update to succeed.");
      const persisted = await mongoGiftRepository.updateDraft(updated.data, revision, [accessor]);
      if (!persisted) throw new Error("Expected the save to persist.");
      current = persisted;
    }

    const kept = revisions.documents
      .filter((document) => document["giftId"] === draft.id)
      .map((document) => Number(document["revision"]));
    expect(kept).toEqual(Array.from({ length: 20 }, (_, index) => index + 6));
    // Another gift's history is untouched.
    expect(revisions.documents).toContainEqual(otherGift);
  });

  it("claims with both anonymous credentials and clears them", async () => {
    await mongoGiftRepository.createDraft(draft, idempotency);

    await expect(
      mongoGiftRepository.claimDraft(
        draft.publicId,
        "user-1",
        draft.ownership.anonymousDraftId!,
        "b".repeat(64),
        new Date(),
      ),
    ).resolves.toBeNull();
    await expect(
      mongoGiftRepository.claimDraft(
        draft.publicId,
        "user-1",
        draft.ownership.anonymousDraftId!,
        draft.ownership.claimTokenHash!,
        new Date(),
      ),
    ).resolves.toMatchObject({
      ownership: { anonymousDraftId: null, claimTokenHash: null, ownerId: "user-1" },
    });
  });

  it("replays only while actor, request and current ownership still match", async () => {
    await mongoGiftRepository.createDraft(draft, idempotency);

    await expect(mongoGiftRepository.createDraft(draft, idempotency)).resolves.toMatchObject({
      gift: { id: draft.id },
      status: "replayed",
    });
    await expect(
      mongoGiftRepository.createDraft(draft, {
        ...idempotency,
        accessor: { kind: "user", userId: "other" },
        actorKey: "user:other",
      }),
    ).resolves.toEqual({ status: "conflict" });
    await expect(
      mongoGiftRepository.createDraft(draft, {
        ...idempotency,
        requestFingerprint: JSON.stringify(["another-template", "1.0.0"]),
      }),
    ).resolves.toEqual({ status: "conflict" });

    await mongoGiftRepository.claimDraft(
      draft.publicId,
      "user-1",
      draft.ownership.anonymousDraftId!,
      draft.ownership.claimTokenHash!,
      new Date(),
    );
    await expect(mongoGiftRepository.createDraft(draft, idempotency)).resolves.toEqual({
      status: "conflict",
    });
    expect(gifts.documents).toHaveLength(1);
    expect(revisions.documents).toHaveLength(1);
  });

  it("stores a draft without share fields", async () => {
    await mongoGiftRepository.createDraft(draft, idempotency);

    expect(gifts.documents[0]).not.toHaveProperty("shareId");
    expect(gifts.documents[0]).not.toHaveProperty("publishedAt");
  });
});

describe("Mongo gift repository publishing", () => {
  const shareId = "Ab0_-cdefghijklmnopqrs";
  const ownerId = "owner-1";
  const now = new Date("2026-10-01T08:00:00.000Z");
  const assetA = "550e8400-e29b-41d4-a716-446655440000";
  const assetB = "550e8400-e29b-41d4-a716-446655440001";
  const owned = createGiftDraft({
    anonymousDraftId: null,
    claimTokenHash: null,
    content: {
      data: { memories: [{ assetId: assetA }, { assetId: assetB }] },
      schemaVersion: 1,
      templateId: "memory-box",
      templateVersion: "1.1.0",
    },
    id: "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
    now: new Date("2026-09-16T00:00:00.000Z"),
    ownerId,
    publicId: "q1w2e3r4t5y6u7i8",
  });
  const grant = grantEntitlement(currentPlan("free"), "free", now);
  const publishedResult = publishGiftDraft(owned, { expectedRevision: 0, grant, now, shareId });
  if (!publishedResult.ok) throw new Error("Expected a published gift.");
  const published = publishedResult.data;
  const publication = createGiftPublication({
    artifactContentHash: "f".repeat(64),
    assetIds: [assetA, assetB],
    audioTrackId: null,
    gift: published,
    id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  });
  const { id: publicationId, ...publicationFields } = publication;
  const publicationDocument = { _id: publicationId, ...publicationFields };
  const publishIdempotency = {
    actorKey: `user:${ownerId}`,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    key: "9c1b2f0e-6a7d-4c90-8d7a-4a559c1b2f0e",
    requestFingerprint: JSON.stringify(["publish", owned.publicId, 0]),
    scope: "gift-publish" as const,
  };
  const input = {
    assetRefs: [{ assetIds: [assetA, assetB], fieldId: "memories" }],
    expectedRevision: 0,
    gift: published,
    idempotency: publishIdempotency,
    ownerId,
    precondition: { status: "draft" } as const,
    publication,
  };
  const later = new Date("2026-10-02T09:00:00.000Z");
  /** The same gift, its working copy saved to revision 2, published again. */
  function updateInput(
    precondition: Readonly<{ publishedRevision: number | undefined }> = { publishedRevision: 0 },
  ) {
    let gift = published;
    for (const revision of [0, 1]) {
      const saved = updateGiftDraft(gift, {
        content: gift.content,
        expectedRevision: revision,
        now,
      });
      if (!saved.ok) throw new Error("Expected the working copy to save.");
      gift = saved.data;
    }
    const republished = republishGift(gift, { expectedRevision: 2, now: later });
    if (!republished.ok) throw new Error("Expected the update to be accepted.");
    return {
      ...input,
      expectedRevision: 2,
      gift: republished.data,
      idempotency: {
        ...publishIdempotency,
        key: "5f1f2c6e-1e0b-4a5f-9a39-0d6c5f1f2c6e",
        requestFingerprint: JSON.stringify(["publish", owned.publicId, 2]),
      },
      precondition: { ...precondition, now: later, status: "published" } as const,
      publication: createGiftPublication({
        artifactContentHash: "f".repeat(64),
        assetIds: [assetA, assetB],
        audioTrackId: null,
        gift: republished.data,
        id: "1f8fad5b-d9cb-469f-a165-70867728950e",
      }),
    };
  }

  const collections = {
    assets: { updateMany: vi.fn() },
    gifts: { findOne: vi.fn(), findOneAndUpdate: vi.fn() },
    giftPublications: { findOne: vi.fn(), insertOne: vi.fn() },
    idempotencyKeys: { findOne: vi.fn(), insertOne: vi.fn() },
  };
  const session = { id: "session-1" };
  // Any session object: the transaction's session, whichever the driver passes.
  const inSession: unknown = expect.anything();

  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: keyof typeof collections) => collections[name],
    });
    databaseMocks.getMongoClient.mockResolvedValue({
      withSession: async (operation: (value: unknown) => Promise<void>) =>
        operation({
          ...session,
          withTransaction: (transaction: () => Promise<void>) => transaction(),
        }),
    });
    collections.idempotencyKeys.findOne.mockResolvedValue(null);
    collections.gifts.findOneAndUpdate.mockResolvedValue({ _id: owned.id });
    collections.assets.updateMany.mockResolvedValue({ matchedCount: 2, modifiedCount: 2 });
    collections.giftPublications.insertOne.mockResolvedValue({ acknowledged: true });
    collections.idempotencyKeys.insertOne.mockResolvedValue({ acknowledged: true });
    collections.giftPublications.findOne.mockResolvedValue(publicationDocument);
  });

  it("publishes in one transaction with owner, status, access and revision filters", async () => {
    await expect(mongoGiftRepository.publish(input)).resolves.toEqual({
      publication,
      status: "published",
    });

    expect(collections.gifts.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: owned.id,
        "access.mode": "unlisted",
        "ownership.ownerId": ownerId,
        revision: 0,
        status: "draft",
      },
      {
        $set: {
          entitlement: grant.entitlement,
          expiresAt: grant.expiresAt,
          publishedAt: now,
          publishedRevision: 0,
          shareId,
          status: "published",
          updatedAt: now,
        },
      },
      expect.objectContaining({ returnDocument: "after", session: inSession }),
    );
    expect(collections.giftPublications.insertOne).toHaveBeenCalledWith(publicationDocument, {
      session: inSession,
    });
    expect(collections.idempotencyKeys.insertOne).toHaveBeenCalledWith(
      {
        _id: `gift-publish:${publishIdempotency.key}`,
        actorKey: `user:${ownerId}`,
        createdAt: now,
        expiresAt: new Date("2026-10-02T08:00:00.000Z"),
        giftId: owned.id,
        key: publishIdempotency.key,
        requestFingerprint: publishIdempotency.requestFingerprint,
        scope: "gift-publish",
        updatedAt: now,
      },
      { session: inSession },
    );
  });

  it("writes every referenced ready asset with $currentDate, never a no-op $set", async () => {
    await mongoGiftRepository.publish(input);

    expect(collections.assets.updateMany).toHaveBeenCalledWith(
      {
        $or: [{ _id: { $in: [assetA, assetB] }, fieldId: "memories" }],
        detachedAt: null,
        giftId: owned.id,
        status: "ready",
      },
      { $currentDate: { updatedAt: true } },
      { session: inSession },
    );
    const [, update] = collections.assets.updateMany.mock.lastCall as [unknown, object];
    expect(update).not.toHaveProperty("$set");
  });

  it("skips the asset write when the content references no image", async () => {
    await mongoGiftRepository.publish({ ...input, assetRefs: [] });

    expect(collections.assets.updateMany).not.toHaveBeenCalled();
    expect(collections.giftPublications.insertOne).toHaveBeenCalled();
  });

  it("aborts with assets-changed when a referenced asset is no longer ready", async () => {
    collections.assets.updateMany.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    await expect(mongoGiftRepository.publish(input)).resolves.toEqual({
      status: "assets-changed",
    });
    expect(collections.giftPublications.insertOne).not.toHaveBeenCalled();
    expect(collections.idempotencyKeys.insertOne).not.toHaveBeenCalled();
  });

  it("aborts with stale when the conditional gift write matches nothing", async () => {
    collections.gifts.findOneAndUpdate.mockResolvedValue(null);

    await expect(mongoGiftRepository.publish(input)).resolves.toEqual({ status: "stale" });
    expect(collections.assets.updateMany).not.toHaveBeenCalled();
    expect(collections.giftPublications.insertOne).not.toHaveBeenCalled();
  });

  it("replays a stored key of the same request without writing", async () => {
    collections.idempotencyKeys.findOne.mockResolvedValue({
      actorKey: `user:${ownerId}`,
      giftId: owned.id,
      requestFingerprint: publishIdempotency.requestFingerprint,
    });

    await expect(mongoGiftRepository.publish(input)).resolves.toEqual({
      publication,
      status: "replayed",
    });
    expect(collections.idempotencyKeys.findOne).toHaveBeenCalledWith(
      { key: publishIdempotency.key, scope: "gift-publish" },
      { session: inSession },
    );
    expect(collections.giftPublications.findOne).toHaveBeenCalledWith(
      { giftId: owned.id, revision: 0 },
      { session: inSession },
    );
    expect(collections.gifts.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    { actorKey: "user:someone-else" },
    { requestFingerprint: JSON.stringify(["publish", owned.publicId, 5]) },
    { giftId: "another-gift" },
  ])("answers idempotency-conflict for a key of another request %o", async (difference) => {
    collections.idempotencyKeys.findOne.mockResolvedValue({
      actorKey: `user:${ownerId}`,
      giftId: owned.id,
      requestFingerprint: publishIdempotency.requestFingerprint,
      ...difference,
    });

    await expect(mongoGiftRepository.publish(input)).resolves.toEqual({
      status: "idempotency-conflict",
    });
    expect(collections.gifts.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("answers idempotency-conflict when the stored key has no publication", async () => {
    collections.idempotencyKeys.findOne.mockResolvedValue({
      actorKey: `user:${ownerId}`,
      giftId: owned.id,
      requestFingerprint: publishIdempotency.requestFingerprint,
    });
    collections.giftPublications.findOne.mockResolvedValue(null);

    await expect(
      mongoGiftRepository.findPublishReplay(publishIdempotency, owned.id, 0),
    ).resolves.toEqual({ status: "idempotency-conflict" });
  });

  it("re-reads the key after a duplicate-key error from a concurrent request", async () => {
    collections.idempotencyKeys.insertOne.mockRejectedValue(
      new MongoServerError({ code: 11000, errmsg: "E11000 duplicate key", message: "E11000" }),
    );
    collections.idempotencyKeys.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      actorKey: `user:${ownerId}`,
      giftId: owned.id,
      requestFingerprint: publishIdempotency.requestFingerprint,
    });

    await expect(mongoGiftRepository.publish(input)).resolves.toEqual({
      publication,
      status: "replayed",
    });
  });

  it("rethrows a duplicate-key error that no stored key explains", async () => {
    const duplicate = new MongoServerError({
      code: 11000,
      errmsg: "E11000 duplicate key",
      message: "E11000",
    });
    collections.giftPublications.insertOne.mockRejectedValue(duplicate);

    await expect(mongoGiftRepository.publish(input)).rejects.toBe(duplicate);
  });

  it("updates a published gift: same share id, new pointer, conditional on the current one", async () => {
    const update = updateInput();
    await expect(mongoGiftRepository.publish(update)).resolves.toEqual({
      publication: update.publication,
      status: "published",
    });

    expect(collections.gifts.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: owned.id,
        "access.mode": "unlisted",
        expiresAt: { $gt: later },
        "ownership.ownerId": ownerId,
        publishedRevision: 0,
        revision: 2,
        status: "published",
      },
      {
        $set: { publishedAt: later, publishedRevision: 2, status: "published", updatedAt: later },
      },
      expect.objectContaining({ returnDocument: "after", session: inSession }),
    );
    expect(update.publication).toMatchObject({ revision: 2, shareId });
  });

  it("updates a legacy published gift that has no pointer yet", async () => {
    await mongoGiftRepository.publish(updateInput({ publishedRevision: undefined }));

    const [filter] = collections.gifts.findOneAndUpdate.mock.lastCall as [object];
    expect(filter).toMatchObject({ publishedRevision: { $exists: false }, status: "published" });
  });

  it("replays a key by the request's revision, even after a later update (D5)", async () => {
    collections.idempotencyKeys.findOne.mockResolvedValue({
      actorKey: `user:${ownerId}`,
      giftId: owned.id,
      requestFingerprint: publishIdempotency.requestFingerprint,
    });

    await mongoGiftRepository.findPublishReplay(publishIdempotency, owned.id, 0);

    expect(collections.giftPublications.findOne).toHaveBeenLastCalledWith(
      { giftId: owned.id, revision: 0 },
      undefined,
    );
  });

  it("answers revision-taken when another key published the same revision first", async () => {
    collections.giftPublications.insertOne.mockRejectedValue(
      new MongoServerError({
        code: 11000,
        errmsg: "E11000 duplicate key error index: gift_publications_gift_revision_unique",
        message: "E11000 duplicate key error index: gift_publications_gift_revision_unique",
      }),
    );

    await expect(mongoGiftRepository.publish(updateInput())).resolves.toEqual({
      status: "revision-taken",
    });
  });

  it("rethrows other errors", async () => {
    collections.gifts.findOneAndUpdate.mockRejectedValue(new Error("network"));

    await expect(mongoGiftRepository.publish(input)).rejects.toThrow("network");
  });

  it("looks a share id up as a string among published, unlisted, unexpired gifts", async () => {
    collections.gifts.findOne.mockResolvedValue(null);
    await expect(mongoGiftRepository.findPublishedByShareId(shareId, later)).resolves.toBeNull();
    expect(collections.gifts.findOne).toHaveBeenCalledWith({
      "access.mode": "unlisted",
      expiresAt: { $gt: later },
      shareId: { $eq: shareId, $type: "string" },
      status: "published",
    });

    const { id, ...fields } = published;
    collections.gifts.findOne.mockResolvedValue({ _id: id, ...fields });
    await expect(mongoGiftRepository.findPublishedByShareId(shareId, later)).resolves.toMatchObject(
      {
        id,
        shareId,
        status: "published",
      },
    );
  });
});

describe("Mongo gift repository media references", () => {
  const giftId = "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89";
  const assetA = "550e8400-e29b-41d4-a716-446655440000";
  const find = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.getDatabase.mockResolvedValue({ collection: () => ({ find }) });
  });

  it("accepts only referenceable assets that are not detached from the working copy", async () => {
    find.mockReturnValue({ toArray: () => Promise.resolve([]) });

    await expect(
      mongoGiftRepository.validateMediaReferences(giftId, [
        { assetIds: [assetA], fieldId: "memories" },
      ]),
    ).resolves.toBe(false);
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ detachedAt: null, giftId }), {
      projection: { _id: 1, fieldId: 1 },
    });

    find.mockReturnValue({
      toArray: () => Promise.resolve([{ _id: assetA, fieldId: "memories" }]),
    });
    await expect(
      mongoGiftRepository.validateMediaReferences(giftId, [
        { assetIds: [assetA], fieldId: "memories" },
      ]),
    ).resolves.toBe(true);
  });
});
