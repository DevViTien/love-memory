import "server-only";

import { COLLECTIONS, getDatabase, getMongoClient } from "@love-memory/database";
import { MEDIA_ASSET_LIMITS, MediaAssetSchema, type MediaAsset } from "@love-memory/domain";
import { MongoServerError } from "mongodb";
import { randomUUID } from "node:crypto";

import { type MediaAssetRepository } from "../application/media-service";
import { type ClaimedMediaJob, type MediaWorkerRepository } from "../application/media-worker";

type MediaAssetDocument = Omit<MediaAsset, "id"> & Readonly<{ _id: string }>;

type MediaJobDocument = Readonly<{
  _id: string;
  attempts: number;
  availableAt: Date;
  createdAt: Date;
  deduplicationKey: string;
  payload: Readonly<{ assetId: string }>;
  status: "completed" | "failed" | "pending" | "processing";
  type: "media.process.v1";
  updatedAt: Date;
}>;

function toDocument(asset: MediaAsset): MediaAssetDocument {
  const { id, ...document } = asset;
  return { _id: id, ...document };
}

function toDomain(document: MediaAssetDocument): MediaAsset {
  const { _id, ...asset } = document;
  return MediaAssetSchema.parse({ ...asset, id: _id });
}

function jobDocument(assetId: string, attempt: number, now: Date): MediaJobDocument {
  return {
    _id: randomUUID(),
    attempts: 0,
    availableAt: now,
    createdAt: now,
    deduplicationKey: `media.process.v1:${assetId}:${attempt}`,
    payload: { assetId },
    status: "pending",
    type: "media.process.v1",
    updatedAt: now,
  };
}

const activeStatuses: readonly MediaAsset["status"][] = [
  "initiated",
  "uploaded",
  "processing",
  "ready",
  "failed",
  "deleting",
];

function firstAvailableSlot(used: readonly number[], maximum: number): number | null {
  const occupied = new Set(used);
  for (let slot = 0; slot < maximum; slot += 1) {
    if (!occupied.has(slot)) return slot;
  }
  return null;
}

function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}

export const mongoMediaAssetRepository: MediaAssetRepository = {
  async createWithinQuota(asset, maximumAssetsForGift, maximumAssetsForField) {
    const database = await getDatabase();
    const client = await getMongoClient();

    for (let reservationAttempt = 0; reservationAttempt < 4; reservationAttempt += 1) {
      let created = false;
      try {
        await client.withSession(async (session) => {
          await session.withTransaction(async () => {
            const collection = database.collection<MediaAssetDocument>(COLLECTIONS.assets);
            const [giftSlots, fieldSlots, giftAssetCount, fieldAssetCount] = await Promise.all([
              collection.distinct(
                "giftSlot",
                {
                  giftId: asset.giftId,
                  status: { $in: activeStatuses },
                },
                { session },
              ),
              collection.distinct(
                "fieldSlot",
                {
                  fieldId: asset.fieldId,
                  giftId: asset.giftId,
                  status: { $in: activeStatuses },
                },
                { session },
              ),
              collection.countDocuments(
                { giftId: asset.giftId, status: { $in: activeStatuses } },
                { session },
              ),
              collection.countDocuments(
                {
                  fieldId: asset.fieldId,
                  giftId: asset.giftId,
                  status: { $in: activeStatuses },
                },
                { session },
              ),
            ]);
            if (
              giftAssetCount >= maximumAssetsForGift ||
              fieldAssetCount >= maximumAssetsForField
            ) {
              return;
            }
            const giftSlot = firstAvailableSlot(
              giftSlots.filter((slot): slot is number => typeof slot === "number"),
              maximumAssetsForGift,
            );
            const fieldSlot = firstAvailableSlot(
              fieldSlots.filter((slot): slot is number => typeof slot === "number"),
              maximumAssetsForField,
            );
            if (giftSlot === null || fieldSlot === null) return;
            await collection.insertOne(toDocument({ ...asset, fieldSlot, giftSlot }), { session });
            created = true;
          });
        });
        return created;
      } catch (error) {
        if (!isDuplicateKeyError(error) || reservationAttempt === 3) throw error;
      }
    }
    return false;
  },

  async findById(assetId) {
    const database = await getDatabase();
    const document = await database
      .collection<MediaAssetDocument>(COLLECTIONS.assets)
      .findOne({ _id: assetId });
    return document ? toDomain(document) : null;
  },

  async listByGiftId(giftId) {
    const database = await getDatabase();
    const documents = await database
      .collection<MediaAssetDocument>(COLLECTIONS.assets)
      .find({ giftId, status: { $ne: "deleted" } })
      .sort({ createdAt: 1 })
      .toArray();
    return documents.map(toDomain);
  },

  async releaseInitiated(assetId, now) {
    const database = await getDatabase();
    const result = await database.collection<MediaAssetDocument>(COLLECTIONS.assets).updateOne(
      { _id: assetId, status: "initiated" },
      {
        $set: {
          expiresAt: null,
          failureCode: null,
          status: "deleted",
          updatedAt: now,
        },
      },
    );
    return result.modifiedCount === 1;
  },

  async markDeleted(assetId, now) {
    const database = await getDatabase();
    const result = await database
      .collection<MediaAssetDocument>(COLLECTIONS.assets)
      .updateOne(
        { _id: assetId, status: "deleting" },
        { $set: { expiresAt: null, status: "deleted", updatedAt: now } },
      );
    return result.modifiedCount === 1;
  },

  async markDeleting(assetId, now) {
    const database = await getDatabase();
    const document = await database
      .collection<MediaAssetDocument>(COLLECTIONS.assets)
      .findOneAndUpdate(
        { _id: assetId, status: { $ne: "deleted" } },
        {
          $set: {
            expiresAt: new Date(now.getTime() + 60_000),
            status: "deleting",
            updatedAt: now,
          },
        },
        { returnDocument: "after" },
      );
    return document ? toDomain(document) : null;
  },

  async markFailed(assetId, failureCode, now) {
    const database = await getDatabase();
    const result = await database
      .collection<MediaAssetDocument>(COLLECTIONS.assets)
      .updateOne(
        { _id: assetId, status: "initiated" },
        { $set: { failureCode, status: "failed", updatedAt: now } },
      );
    return result.modifiedCount === 1;
  },

  async markUploadedAndEnqueue(assetId, now) {
    const database = await getDatabase();
    const client = await getMongoClient();
    let asset: MediaAssetDocument | null = null;

    await client.withSession(async (session) => {
      await session.withTransaction(async () => {
        asset = await database.collection<MediaAssetDocument>(COLLECTIONS.assets).findOneAndUpdate(
          { _id: assetId, status: "initiated" },
          {
            $set: {
              expiresAt: null,
              failureCode: null,
              status: "uploaded",
              updatedAt: now,
            },
          },
          { returnDocument: "after", session },
        );
        if (asset) {
          await database
            .collection<MediaJobDocument>(COLLECTIONS.jobOutbox)
            .insertOne(jobDocument(assetId, 0, now), { session });
        }
      });
    });
    return asset ? toDomain(asset) : null;
  },

  async requeue(assetId, now) {
    const database = await getDatabase();
    const client = await getMongoClient();
    let asset: MediaAssetDocument | null = null;

    await client.withSession(async (session) => {
      await session.withTransaction(async () => {
        asset = await database
          .collection<MediaAssetDocument>(COLLECTIONS.assets)
          .findOneAndUpdate(
            { _id: assetId, status: "failed" },
            { $set: { failureCode: null, status: "uploaded", updatedAt: now } },
            { returnDocument: "after", session },
          );
        if (asset) {
          const pending = await database
            .collection<MediaJobDocument>(COLLECTIONS.jobOutbox)
            .updateOne(
              { "payload.assetId": assetId, status: "pending", type: "media.process.v1" },
              { $set: { availableAt: now, updatedAt: now } },
              { session },
            );
          if (pending.matchedCount === 0) {
            await database
              .collection<MediaJobDocument>(COLLECTIONS.jobOutbox)
              .insertOne(jobDocument(assetId, asset.attempts, now), { session });
          }
        }
      });
    });
    return asset ? toDomain(asset) : null;
  },
};

export const mongoMediaWorkerRepository: MediaWorkerRepository = {
  async claimExpiredUpload(now) {
    const database = await getDatabase();
    const document = await database
      .collection<MediaAssetDocument>(COLLECTIONS.assets)
      .findOneAndUpdate(
        { expiresAt: { $lte: now }, status: { $in: ["initiated", "deleting"] } },
        {
          $set: {
            expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
            status: "deleting",
            updatedAt: now,
          },
        },
        { returnDocument: "after", sort: { expiresAt: 1 } },
      );
    return document ? toDomain(document) : null;
  },

  async claimNext(now): Promise<ClaimedMediaJob | null> {
    const database = await getDatabase();
    const client = await getMongoClient();
    let claimed: ClaimedMediaJob | null = null;

    await client.withSession(async (session) => {
      await session.withTransaction(async () => {
        const job = await database
          .collection<MediaJobDocument>(COLLECTIONS.jobOutbox)
          .findOneAndUpdate(
            {
              $or: [
                { availableAt: { $lte: now }, status: "pending" },
                {
                  status: "processing",
                  updatedAt: { $lte: new Date(now.getTime() - 10 * 60 * 1000) },
                },
              ],
              attempts: { $lt: MEDIA_ASSET_LIMITS.maximumAttempts },
              type: "media.process.v1",
            },
            { $inc: { attempts: 1 }, $set: { status: "processing", updatedAt: now } },
            { returnDocument: "after", session, sort: { availableAt: 1, createdAt: 1 } },
          );
        if (!job) {
          const exhausted = await database
            .collection<MediaJobDocument>(COLLECTIONS.jobOutbox)
            .findOneAndUpdate(
              {
                attempts: { $gte: MEDIA_ASSET_LIMITS.maximumAttempts },
                status: "processing",
                type: "media.process.v1",
                updatedAt: { $lte: new Date(now.getTime() - 10 * 60 * 1000) },
              },
              { $set: { status: "failed", updatedAt: now } },
              { returnDocument: "after", session, sort: { updatedAt: 1 } },
            );
          if (exhausted) {
            await database.collection<MediaAssetDocument>(COLLECTIONS.assets).updateOne(
              { _id: exhausted.payload.assetId, status: "processing" },
              {
                $set: {
                  failureCode: "PROCESSING_FAILED",
                  status: "failed",
                  updatedAt: now,
                },
              },
              { session },
            );
          }
          return;
        }

        const document = await database
          .collection<MediaAssetDocument>(COLLECTIONS.assets)
          .findOneAndUpdate(
            {
              _id: job.payload.assetId,
              attempts: { $lt: MEDIA_ASSET_LIMITS.maximumAttempts },
              status: { $in: ["uploaded", "failed", "processing"] },
            },
            {
              $inc: { attempts: 1 },
              $set: { failureCode: null, status: "processing", updatedAt: now },
            },
            { returnDocument: "after", session },
          );
        if (!document) {
          await database.collection<MediaAssetDocument>(COLLECTIONS.assets).updateOne(
            { _id: job.payload.assetId, status: "processing" },
            {
              $set: {
                failureCode: "PROCESSING_FAILED",
                status: "failed",
                updatedAt: now,
              },
            },
            { session },
          );
          await database
            .collection<MediaJobDocument>(COLLECTIONS.jobOutbox)
            .updateOne(
              { _id: job._id },
              { $set: { status: "failed", updatedAt: now } },
              { session },
            );
          return;
        }
        claimed = { asset: toDomain(document), jobId: job._id };
      });
    });
    return claimed;
  },

  async complete(assetId, jobId, output, now) {
    const database = await getDatabase();
    const client = await getMongoClient();
    await client.withSession(async (session) => {
      await session.withTransaction(async () => {
        const assetResult = await database
          .collection<MediaAssetDocument>(COLLECTIONS.assets)
          .updateOne(
            { _id: assetId, status: "processing" },
            {
              $set: {
                checksumSha256: output.checksumSha256,
                derivatives: [...output.derivatives],
                expiresAt: null,
                failureCode: null,
                placeholderDataUrl: output.placeholderDataUrl,
                status: "ready",
                updatedAt: now,
              },
            },
            { session },
          );
        if (assetResult.modifiedCount !== 1) {
          throw new Error("Media asset left processing state before completion.");
        }
        await database
          .collection<MediaJobDocument>(COLLECTIONS.jobOutbox)
          .updateOne(
            { _id: jobId, status: "processing" },
            { $set: { status: "completed", updatedAt: now } },
            { session },
          );
      });
    });
  },

  async fail(assetId, jobId, failureCode, retryAt, now) {
    const database = await getDatabase();
    const client = await getMongoClient();
    await client.withSession(async (session) => {
      await session.withTransaction(async () => {
        await database
          .collection<MediaAssetDocument>(COLLECTIONS.assets)
          .updateOne(
            { _id: assetId, status: "processing" },
            { $set: { failureCode, status: "failed", updatedAt: now } },
            { session },
          );
        await database.collection<MediaJobDocument>(COLLECTIONS.jobOutbox).updateOne(
          { _id: jobId, status: "processing" },
          {
            $set: retryAt
              ? { availableAt: retryAt, status: "pending", updatedAt: now }
              : { status: "failed", updatedAt: now },
          },
          { session },
        );
      });
    });
  },

  async finishExpiredCleanup(assetId, now) {
    const database = await getDatabase();
    await database
      .collection<MediaAssetDocument>(COLLECTIONS.assets)
      .updateOne(
        { _id: assetId, status: "deleting" },
        { $set: { expiresAt: null, status: "deleted", updatedAt: now } },
      );
  },

  async failExpiredCleanup(assetId, now) {
    const database = await getDatabase();
    await database.collection<MediaAssetDocument>(COLLECTIONS.assets).updateOne(
      { _id: assetId, status: "deleting" },
      {
        $set: {
          expiresAt: new Date(now.getTime() + 60_000),
          failureCode: "PROCESSING_FAILED",
          status: "deleting",
          updatedAt: now,
        },
      },
    );
  },
};
