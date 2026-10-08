import "server-only";

import { COLLECTIONS, getDatabase, getMongoClient } from "@love-memory/database";
import {
  EDITABLE_GIFT_STATUSES,
  MEDIA_ASSET_LIMITS,
  MediaAssetSchema,
  type MediaAsset,
} from "@love-memory/domain";
import { MongoServerError } from "mongodb";
import { randomUUID } from "node:crypto";

import { type DetachedAssetRepository } from "../application/gift-assets-cleanup";
import { type MarkDeletingResult, type MediaAssetRepository } from "../application/media-service";
import { type MediaOutboxMonitor } from "../application/media-outbox-health";
import { type ClaimResult, type MediaWorkerRepository } from "../application/media-worker";

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

function isSlot(slot: number | null | undefined): slot is number {
  return typeof slot === "number";
}

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
            // withTransaction re-runs this callback after a transient error; a rolled-back
            // attempt must not leave `created` set.
            created = false;
            const collection = database.collection<MediaAssetDocument>(COLLECTIONS.assets);
            // One projected find instead of `distinct` (not in Stable API V1, which the client
            // enforces) and instead of parallel reads, which one transaction does not support.
            const occupied = await collection
              .find(
                // A detached asset no longer holds a quota slot (`null` also matches legacy ones).
                { detachedAt: null, giftId: asset.giftId, status: { $in: activeStatuses } },
                { projection: { _id: 0, fieldId: 1, fieldSlot: 1, giftSlot: 1 }, session },
              )
              .toArray();
            const fieldOccupied = occupied.filter((document) => document.fieldId === asset.fieldId);
            if (
              occupied.length >= maximumAssetsForGift ||
              fieldOccupied.length >= maximumAssetsForField
            ) {
              return;
            }
            const giftSlot = firstAvailableSlot(
              occupied.map((document) => document.giftSlot).filter(isSlot),
              maximumAssetsForGift,
            );
            const fieldSlot = firstAvailableSlot(
              fieldOccupied.map((document) => document.fieldSlot).filter(isSlot),
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
      .find({ detachedAt: null, giftId, status: { $ne: "deleted" } })
      .sort({ createdAt: 1 })
      .toArray();
    return documents.map(toDomain);
  },

  async listByIdsForGift(giftId, assetIds) {
    if (assetIds.length === 0) return [];
    const database = await getDatabase();
    const documents = await database
      .collection<MediaAssetDocument>(COLLECTIONS.assets)
      .find({ _id: { $in: [...assetIds] }, giftId })
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

  async markDeleting(assetId, giftId, now) {
    const database = await getDatabase();
    const client = await getMongoClient();
    let result: MarkDeletingResult | null = null;

    await client.withSession(async (session) => {
      await session.withTransaction(async () => {
        result = null;
        // Read in the same transaction as the asset write. A publish writes every asset it
        // references, so the two transactions conflict and the retried one sees the other's state.
        const gift = await database
          .collection<{
            _id: string;
            publishedRevision?: number;
            revision: number;
            status: string;
          }>(COLLECTIONS.gifts)
          .findOne(
            { _id: giftId, status: { $in: [...EDITABLE_GIFT_STATUSES] } },
            { projection: { _id: 1, publishedRevision: 1, revision: 1, status: 1 }, session },
          );
        if (!gift) {
          result = { kind: "gift-not-editable" };
          return;
        }
        if (gift.status === "published") {
          // A gift published before the pointer existed has only the publication of its revision.
          const publication = await database
            .collection<{ assetIds: string[] }>(COLLECTIONS.giftPublications)
            .findOne(
              { giftId, revision: gift.publishedRevision ?? gift.revision },
              { projection: { _id: 0, assetIds: 1 }, session },
            );
          if (publication?.assetIds.includes(assetId)) {
            // Recipients still see it: keep the objects, leave the working copy and its quotas.
            const detached = await database
              .collection<MediaAssetDocument>(COLLECTIONS.assets)
              .updateOne(
                { _id: assetId, detachedAt: null, giftId, status: "ready" },
                { $set: { detachedAt: now, fieldSlot: null, giftSlot: null, updatedAt: now } },
                { session },
              );
            result =
              detached.modifiedCount === 1 ? { kind: "detached" } : { kind: "asset-unavailable" };
            return;
          }
        }
        const document = await database
          .collection<MediaAssetDocument>(COLLECTIONS.assets)
          .findOneAndUpdate(
            { _id: assetId, detachedAt: null, giftId, status: { $ne: "deleted" } },
            {
              $set: {
                expiresAt: new Date(now.getTime() + 60_000),
                status: "deleting",
                updatedAt: now,
              },
            },
            { returnDocument: "after", session },
          );
        result = document
          ? { asset: toDomain(document), kind: "deleting" }
          : { kind: "asset-unavailable" };
      });
    });

    if (!result) throw new Error("Asset deletion transaction completed without a result.");
    return result;
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

  async claimNext(now): Promise<ClaimResult> {
    const database = await getDatabase();
    const client = await getMongoClient();
    let claimed: ClaimResult = null;

    await client.withSession(async (session) => {
      await session.withTransaction(async () => {
        // A retried callback must not return a claim from a rolled-back attempt.
        claimed = null;
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
            const failed = await database
              .collection<MediaAssetDocument>(COLLECTIONS.assets)
              .findOneAndUpdate(
                { _id: exhausted.payload.assetId, status: "processing" },
                {
                  $set: {
                    failureCode: "PROCESSING_FAILED",
                    status: "failed",
                    updatedAt: now,
                  },
                },
                { returnDocument: "after", session },
              );
            // The job is closed either way: a step that ends the drain here would leave every job
            // behind it waiting for the next dispatch or sweep.
            claimed = failed
              ? { exhaustedAsset: toDomain(failed) }
              : { discardedJobId: exhausted._id };
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
          const failed = await database
            .collection<MediaAssetDocument>(COLLECTIONS.assets)
            .findOneAndUpdate(
              { _id: job.payload.assetId, status: "processing" },
              {
                $set: {
                  failureCode: "PROCESSING_FAILED",
                  status: "failed",
                  updatedAt: now,
                },
              },
              { returnDocument: "after", session },
            );
          // An unclaimable asset (typically deleted after its job was enqueued) closes the job; the
          // step is reported as discarded, not idle, so the drain moves on to the next job.
          claimed = failed ? { exhaustedAsset: toDomain(failed) } : { discardedJobId: job._id };
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

/** The detached assets a `gift.assets.cleanup.v1` job may retire (`media-upload`). */
export const mongoDetachedAssetRepository: DetachedAssetRepository = {
  async listDetachedReady(giftId) {
    const database = await getDatabase();
    // `assets_gift_field_created` (prefix `giftId`) serves it; status and detach are residual.
    const documents = await database
      .collection<MediaAssetDocument>(COLLECTIONS.assets)
      .find({ detachedAt: { $ne: null }, giftId, status: "ready" })
      .toArray();
    return documents.map(toDomain);
  },

  async markDeleted(assetId, now) {
    return mongoMediaAssetRepository.markDeleted(assetId, now);
  },

  async markDetachedDeleting(assetId, giftId, now) {
    const database = await getDatabase();
    // Still detached and `ready`: never an asset of the working copy or one already taken.
    const result = await database.collection<MediaAssetDocument>(COLLECTIONS.assets).updateOne(
      { _id: assetId, detachedAt: { $ne: null }, giftId, status: "ready" },
      {
        $set: {
          expiresAt: new Date(now.getTime() + 60 * 1000),
          status: "deleting",
          updatedAt: now,
        },
      },
    );
    return result.modifiedCount === 1;
  },
};

export const mongoMediaOutboxMonitor: MediaOutboxMonitor = {
  async hasOverdueJob(cutoff) {
    const database = await getDatabase();
    // Served by the `job_outbox_available` (status, availableAt) index; returns no job content.
    const job = await database.collection<MediaJobDocument>(COLLECTIONS.jobOutbox).findOne(
      {
        attempts: { $lt: MEDIA_ASSET_LIMITS.maximumAttempts },
        availableAt: { $lte: cutoff },
        status: "pending",
        type: "media.process.v1",
      },
      { projection: { _id: 1 } },
    );
    return job !== null;
  },
};
