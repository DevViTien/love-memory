import { COLLECTIONS, getDatabase, getMongoClient } from "@love-memory/database";
import { GiftSchema, type Gift, type GiftRevision } from "@love-memory/domain";
import { type ClientSession, type Db, type Filter, MongoServerError } from "mongodb";

import {
  type GiftAccessor,
  type GiftCreateIdempotency,
  type GiftCreatePersistenceResult,
  type GiftRepository,
} from "../application/gift-service";

type GiftDocument = Omit<Gift, "id"> & Readonly<{ _id: string }>;
type GiftRevisionDocument = Omit<GiftRevision, "giftId"> &
  Readonly<{ _id: string; giftId: string }>;
type GiftIdempotencyDocument = Readonly<{
  _id: string;
  actorKey: string;
  createdAt: Date;
  expiresAt: Date;
  giftId: string;
  key: string;
  requestFingerprint: string;
  scope: GiftCreateIdempotency["scope"];
  updatedAt: Date;
}>;

type MediaReferenceDocument = Readonly<{
  _id: string;
  giftId: string;
  fieldId: string;
  status: string;
}>;

const referenceableMediaStatuses = [
  "initiated",
  "uploaded",
  "processing",
  "ready",
  "failed",
] as const;

function toDocument(gift: Gift): GiftDocument {
  const { id, ...document } = gift;
  return { _id: id, ...document };
}

function toDomain(document: GiftDocument): Gift {
  const { _id, ...gift } = document;
  return GiftSchema.parse({ ...gift, id: _id });
}

function singleAccessFilter(accessor: GiftAccessor): Filter<GiftDocument> {
  if (accessor.kind === "user") {
    return accessor.isAdmin ? {} : { "ownership.ownerId": accessor.userId };
  }

  return {
    "ownership.anonymousDraftId": accessor.anonymousDraftId,
    "ownership.claimTokenHash": accessor.claimTokenHash,
    "ownership.ownerId": null,
  };
}

function accessFilter(accessors: readonly GiftAccessor[]): Filter<GiftDocument> {
  if (accessors.some((accessor) => accessor.kind === "user" && accessor.isAdmin)) {
    return {};
  }

  const filters = accessors.map(singleAccessFilter);
  if (filters.length === 0) {
    return { _id: { $exists: false } };
  }
  return filters.length === 1 ? filters[0]! : { $or: filters };
}

function toRevisionDocument(gift: Gift): GiftRevisionDocument {
  return {
    _id: `${gift.id}:${gift.revision}`,
    content: gift.content,
    createdAt: gift.updatedAt,
    giftId: gift.id,
    revision: gift.revision,
  };
}

async function findIdempotentGift(
  database: Db,
  idempotency: GiftCreateIdempotency,
  session?: ClientSession,
): Promise<GiftCreatePersistenceResult | null> {
  const record = await database
    .collection<GiftIdempotencyDocument>(COLLECTIONS.idempotencyKeys)
    .findOne({ key: idempotency.key, scope: idempotency.scope }, session ? { session } : undefined);
  if (!record) {
    return null;
  }
  if (
    record.actorKey !== idempotency.actorKey ||
    record.requestFingerprint !== idempotency.requestFingerprint
  ) {
    return { status: "conflict" };
  }

  const gift = await database
    .collection<GiftDocument>(COLLECTIONS.gifts)
    .findOne(
      { ...accessFilter([idempotency.accessor]), _id: record.giftId },
      session ? { session } : undefined,
    );
  if (!gift) {
    return { status: "conflict" };
  }

  return { gift: toDomain(gift), status: "replayed" };
}

function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}

export const mongoGiftRepository: GiftRepository = {
  async claimDraft(publicId, ownerId, anonymousDraftId, claimTokenHash, now) {
    const database = await getDatabase();
    const document = await database.collection<GiftDocument>(COLLECTIONS.gifts).findOneAndUpdate(
      {
        "ownership.claimTokenHash": claimTokenHash,
        "ownership.anonymousDraftId": anonymousDraftId,
        "ownership.ownerId": null,
        publicId,
        status: "draft",
      },
      {
        $set: {
          ownership: { anonymousDraftId: null, claimTokenHash: null, ownerId },
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );

    return document ? toDomain(document) : null;
  },

  async createDraft(gift, idempotency) {
    const database = await getDatabase();
    const client = await getMongoClient();
    let result: GiftCreatePersistenceResult | null = null;

    try {
      await client.withSession(async (session) => {
        await session.withTransaction(async () => {
          const replay = await findIdempotentGift(database, idempotency, session);
          if (replay) {
            result = replay;
            return;
          }

          await database.collection<GiftDocument>(COLLECTIONS.gifts).insertOne(toDocument(gift), {
            session,
          });
          await database
            .collection<GiftRevisionDocument>(COLLECTIONS.giftRevisions)
            .insertOne(toRevisionDocument(gift), { session });
          await database.collection<GiftIdempotencyDocument>(COLLECTIONS.idempotencyKeys).insertOne(
            {
              _id: `${idempotency.scope}:${idempotency.key}`,
              actorKey: idempotency.actorKey,
              createdAt: gift.createdAt,
              expiresAt: idempotency.expiresAt,
              giftId: gift.id,
              key: idempotency.key,
              requestFingerprint: idempotency.requestFingerprint,
              scope: idempotency.scope,
              updatedAt: gift.updatedAt,
            },
            { session },
          );
          result = { gift, status: "created" };
        });
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      result = await findIdempotentGift(database, idempotency);
    }

    if (!result) {
      throw new Error("Gift creation transaction completed without a result.");
    }
    return result;
  },

  async findAuthorized(publicId, accessors) {
    const database = await getDatabase();
    const document = await database
      .collection<GiftDocument>(COLLECTIONS.gifts)
      .findOne({ ...accessFilter(accessors), publicId });

    return document ? toDomain(document) : null;
  },

  async validateMediaReferences(giftId, references) {
    const expected = references.flatMap(({ assetIds, fieldId }) =>
      assetIds.map((assetId) => `${fieldId}:${assetId}`),
    );
    if (expected.length === 0) return true;

    const database = await getDatabase();
    const documents = await database
      .collection<MediaReferenceDocument>(COLLECTIONS.assets)
      .find(
        {
          $or: references.map(({ assetIds, fieldId }) => ({
            _id: { $in: [...assetIds] },
            fieldId,
          })),
          giftId,
          status: { $in: [...referenceableMediaStatuses] },
        },
        { projection: { _id: 1, fieldId: 1 } },
      )
      .toArray();
    const found = new Set(documents.map((document) => `${document.fieldId}:${document._id}`));
    return expected.every((reference) => found.has(reference));
  },

  async updateDraft(gift, expectedRevision, accessors) {
    const database = await getDatabase();
    const client = await getMongoClient();
    let persisted: GiftDocument | null = null;

    await client.withSession(async (session) => {
      await session.withTransaction(async () => {
        persisted = await database.collection<GiftDocument>(COLLECTIONS.gifts).findOneAndUpdate(
          {
            ...accessFilter(accessors),
            _id: gift.id,
            revision: expectedRevision,
            status: "draft",
          },
          {
            $set: { content: gift.content, updatedAt: gift.updatedAt },
            $inc: { revision: 1 },
          },
          { returnDocument: "after", session },
        );

        if (persisted) {
          await database
            .collection<GiftRevisionDocument>(COLLECTIONS.giftRevisions)
            .insertOne(toRevisionDocument(gift), { session });
        }
      });
    });

    return persisted ? toDomain(persisted) : null;
  },
};
