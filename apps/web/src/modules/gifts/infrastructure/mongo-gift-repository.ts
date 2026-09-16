import { COLLECTIONS, getDatabase, getMongoClient } from "@love-memory/database";
import { GiftSchema, type Gift, type GiftRevision } from "@love-memory/domain";
import { type Filter } from "mongodb";

import { type GiftAccessor, type GiftRepository } from "../application/gift-service";

type GiftDocument = Omit<Gift, "id"> & Readonly<{ _id: string }>;
type GiftRevisionDocument = Omit<GiftRevision, "giftId"> &
  Readonly<{ _id: string; giftId: string }>;

function toDocument(gift: Gift): GiftDocument {
  const { id, ...document } = gift;
  return { _id: id, ...document };
}

function toDomain(document: GiftDocument): Gift {
  const { _id, ...gift } = document;
  return GiftSchema.parse({ ...gift, id: _id });
}

function accessFilter(accessor: GiftAccessor): Filter<GiftDocument> {
  if (accessor.kind === "user") {
    return accessor.isAdmin ? {} : { "ownership.ownerId": accessor.userId };
  }

  return {
    "ownership.anonymousDraftId": accessor.anonymousDraftId,
    "ownership.claimTokenHash": accessor.claimTokenHash,
    "ownership.ownerId": null,
  };
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

  async createDraft(gift) {
    const database = await getDatabase();
    const client = await getMongoClient();

    await client.withSession(async (session) => {
      await session.withTransaction(async () => {
        await database.collection<GiftDocument>(COLLECTIONS.gifts).insertOne(toDocument(gift), {
          session,
        });
        await database
          .collection<GiftRevisionDocument>(COLLECTIONS.giftRevisions)
          .insertOne(toRevisionDocument(gift), { session });
      });
    });
  },

  async findAuthorized(publicId, accessor) {
    const database = await getDatabase();
    const document = await database
      .collection<GiftDocument>(COLLECTIONS.gifts)
      .findOne({ ...accessFilter(accessor), publicId });

    return document ? toDomain(document) : null;
  },

  async findByPublicId(publicId) {
    const database = await getDatabase();
    const document = await database
      .collection<GiftDocument>(COLLECTIONS.gifts)
      .findOne({ publicId });

    return document ? toDomain(document) : null;
  },

  async updateDraft(gift, expectedRevision, accessor) {
    const database = await getDatabase();
    const client = await getMongoClient();
    let persisted: GiftDocument | null = null;

    await client.withSession(async (session) => {
      await session.withTransaction(async () => {
        persisted = await database.collection<GiftDocument>(COLLECTIONS.gifts).findOneAndUpdate(
          {
            ...accessFilter(accessor),
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
