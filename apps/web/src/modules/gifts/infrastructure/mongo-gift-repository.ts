import { COLLECTIONS, getDatabase, getMongoClient } from "@love-memory/database";
import { GiftSchema, type Gift, type GiftRevision } from "@love-memory/domain";
import { type ClientSession, type Db, type Filter, MongoServerError } from "mongodb";

import {
  type GiftAccessor,
  type GiftCreateIdempotency,
  type GiftCreatePersistenceResult,
  type GiftPublishIdempotency,
  type GiftPublishPersistenceResult,
  type GiftPublishReplay,
  type GiftRepository,
} from "../application/gift-service";
import {
  type GiftPublicationDocument,
  toPublicationDocument,
  toPublicationDomain,
} from "./mongo-gift-publication-repository";

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
  scope: GiftCreateIdempotency["scope"] | GiftPublishIdempotency["scope"];
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
  // Undefined optional fields are left out, so a draft has no `shareId` key at all: the partial
  // unique index `gifts_share_id_unique` relies on that.
  const defined = Object.fromEntries(
    Object.entries(document).filter(([, value]) => value !== undefined),
  ) as Omit<Gift, "id">;
  return { _id: id, ...defined };
}

function toDomain(document: GiftDocument): Gift {
  const { _id, ...gift } = document;
  return GiftSchema.parse({ ...gift, id: _id });
}

function singleAccessFilter(accessor: GiftAccessor): Filter<GiftDocument> {
  if (accessor.kind === "user") {
    return { "ownership.ownerId": accessor.userId };
  }

  return {
    "ownership.anonymousDraftId": accessor.anonymousDraftId,
    "ownership.claimTokenHash": accessor.claimTokenHash,
    "ownership.ownerId": null,
  };
}

function accessFilter(accessors: readonly GiftAccessor[]): Filter<GiftDocument> {
  const filters = accessors.map(singleAccessFilter);
  if (filters.length === 0) {
    return { _id: { $exists: false } };
  }
  return filters.length === 1 ? filters[0]! : { $or: filters };
}

/** How many of a gift's most recent revision snapshots are kept (`gift-drafts`). */
export const GIFT_REVISION_RETENTION = 20;

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

async function findPublishReplay(
  database: Db,
  idempotency: GiftPublishIdempotency,
  giftId: string,
  session?: ClientSession,
): Promise<GiftPublishReplay | null> {
  const options = session ? { session } : undefined;
  const record = await database
    .collection<GiftIdempotencyDocument>(COLLECTIONS.idempotencyKeys)
    .findOne({ key: idempotency.key, scope: idempotency.scope }, options);
  if (!record) return null;
  if (
    record.actorKey !== idempotency.actorKey ||
    record.requestFingerprint !== idempotency.requestFingerprint ||
    record.giftId !== giftId
  ) {
    return { status: "idempotency-conflict" };
  }

  const publication = await database
    .collection<GiftPublicationDocument>(COLLECTIONS.giftPublications)
    .findOne({ giftId: record.giftId }, options);
  return publication
    ? { publication: toPublicationDomain(publication), status: "replayed" }
    : { status: "idempotency-conflict" };
}

/** Thrown inside the publish transaction to abort it; never escapes the repository. */
class PublishAborted extends Error {
  constructor(readonly outcome: "assets-changed" | "stale") {
    super(`Publish aborted: ${outcome}.`);
  }
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

  async findPublishedByShareId(shareId) {
    const database = await getDatabase();
    const document = await database.collection<GiftDocument>(COLLECTIONS.gifts).findOne({
      // `$type` matches the partial filter of `gifts_share_id_unique`, which makes that index
      // eligible; `$eq` keeps a value from ever being read as an operator.
      "access.mode": "unlisted",
      shareId: { $eq: shareId, $type: "string" },
      status: "published",
    });

    return document ? toDomain(document) : null;
  },

  async findPublishReplay(idempotency, giftId) {
    const database = await getDatabase();
    return findPublishReplay(database, idempotency, giftId);
  },

  async publishDraft({ assetRefs, expectedRevision, gift, idempotency, ownerId, publication }) {
    const database = await getDatabase();
    const client = await getMongoClient();
    let result: GiftPublishPersistenceResult | null = null;
    const references = assetRefs
      .map(({ assetIds, fieldId }) => ({ assetIds: [...new Set(assetIds)], fieldId }))
      .filter(({ assetIds }) => assetIds.length > 0);
    const referencedCount = references.reduce((total, { assetIds }) => total + assetIds.length, 0);

    try {
      await client.withSession(async (session) => {
        await session.withTransaction(async () => {
          // A retried callback must not keep the result of a rolled-back attempt.
          result = null;
          // A concurrent double click: the first commit wins, the other replays its record.
          const replay = await findPublishReplay(database, idempotency, gift.id, session);
          if (replay) {
            result = replay;
            return;
          }

          const updated = await database
            .collection<GiftDocument>(COLLECTIONS.gifts)
            .findOneAndUpdate(
              {
                _id: gift.id,
                "access.mode": "unlisted",
                "ownership.ownerId": ownerId,
                revision: expectedRevision,
                status: "draft",
              },
              {
                $set: {
                  publishedAt: gift.publishedAt,
                  shareId: gift.shareId,
                  status: "published",
                  updatedAt: gift.updatedAt,
                },
              },
              { returnDocument: "after", session },
            );
          if (!updated) throw new PublishAborted("stale");

          if (referencedCount > 0) {
            // A real write to every referenced asset (never a no-op `$set`), so a concurrent
            // deletion of one of them conflicts with this transaction instead of interleaving.
            const confirmed = await database
              .collection<{ _id: string }>(COLLECTIONS.assets)
              .updateMany(
                {
                  $or: references.map(({ assetIds, fieldId }) => ({
                    _id: { $in: assetIds },
                    fieldId,
                  })),
                  giftId: gift.id,
                  status: "ready",
                },
                { $currentDate: { updatedAt: true } },
                { session },
              );
            if (confirmed.matchedCount !== referencedCount) {
              throw new PublishAborted("assets-changed");
            }
          }

          await database
            .collection<GiftPublicationDocument>(COLLECTIONS.giftPublications)
            .insertOne(toPublicationDocument(publication), { session });
          await database.collection<GiftIdempotencyDocument>(COLLECTIONS.idempotencyKeys).insertOne(
            {
              _id: `${idempotency.scope}:${idempotency.key}`,
              actorKey: idempotency.actorKey,
              createdAt: publication.publishedAt,
              expiresAt: idempotency.expiresAt,
              giftId: gift.id,
              key: idempotency.key,
              requestFingerprint: idempotency.requestFingerprint,
              scope: idempotency.scope,
              updatedAt: publication.publishedAt,
            },
            { session },
          );
          result = { publication, status: "published" };
        });
      });
    } catch (error) {
      if (error instanceof PublishAborted) return { status: error.outcome };
      if (!isDuplicateKeyError(error)) throw error;
      // A concurrent request with the same key committed first. Anything else (such as a share
      // id collision, about 2^-128 per pair) surfaces as an error.
      const replay = await findPublishReplay(database, idempotency, gift.id);
      if (!replay) throw error;
      return replay;
    }

    if (!result) {
      throw new Error("Gift publish transaction completed without a result.");
    }
    return result;
  },

  async findDraftById(giftId) {
    const database = await getDatabase();
    const document = await database
      .collection<GiftDocument>(COLLECTIONS.gifts)
      .findOne({ _id: giftId, status: "draft" });

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
          const revisions = database.collection<GiftRevisionDocument>(COLLECTIONS.giftRevisions);
          await revisions.insertOne(toRevisionDocument(gift), { session });
          // Autosave writes a snapshot about every 1.5 s and each holds private gift text: keep the
          // newest ones only, pruned in the same transaction (served by the identity index).
          await revisions.deleteMany(
            { giftId: gift.id, revision: { $lt: gift.revision - (GIFT_REVISION_RETENTION - 1) } },
            { session },
          );
        }
      });
    });

    return persisted ? toDomain(persisted) : null;
  },
};
