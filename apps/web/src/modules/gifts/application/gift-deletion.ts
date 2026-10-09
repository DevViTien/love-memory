import { type Gift, type MediaAsset } from "@love-memory/domain";
import { type ObjectStorage } from "@love-memory/storage";
import { z } from "zod";

import { type JobHandler, JobFailure } from "@/modules/jobs/application/job-registry";

import { GIFT_DELETE_JOB } from "./gift-lifecycle";

/** A tombstone and its audit record last this long (PO decision A4). */
export const GIFT_TOMBSTONE_RETENTION_MILLISECONDS = 365 * 24 * 60 * 60 * 1000;

/** The photos of a gift being purged, and the conditional moves that retire them. */
export interface GiftAssetPurgeRepository {
  /** Every asset record of the gift, in any status. */
  listForGift(giftId: string): Promise<readonly MediaAsset[]>;
  /** Any status but `deleting`/`deleted` → `deleting`; `false` when it no longer matches. */
  markGiftAssetDeleting(assetId: string, giftId: string, now: Date): Promise<boolean>;
  markDeleted(assetId: string, now: Date): Promise<boolean>;
}

export type GiftTombstone = Readonly<{
  createdAt: Date;
  deletedAt: Date;
  deletionRequestedAt: Date;
  expiresAt: Date;
  id: string;
  ownerId: string | null;
  publicId: string;
  publishedAt: Date | null;
}>;

export interface GiftDeletionRepository {
  /** The gift only while it is `deleting`. */
  findDeleting(giftId: string): Promise<Gift | null>;
  /** Revisions, publications, preview tokens, idempotency records, and other non-running jobs. */
  deleteDerived(giftId: string, runningJobId: string): Promise<void>;
  /**
   * One transaction: the tombstone, the removal of the still-`deleting` gift, and the audit record
   * `gift.deleted` with `{ photos, published }`.
   */
  purge(
    input: Readonly<{ photos: number; published: boolean; tombstone: GiftTombstone }>,
  ): Promise<void>;
}

type Dependencies = Readonly<{
  analytics: Readonly<{ deleteForGift: (giftId: string) => Promise<void> }>;
  assets: GiftAssetPurgeRepository;
  gifts: GiftDeletionRepository;
  storage: Pick<ObjectStorage, "deleteObject">;
}>;

/**
 * `gift.delete.v1` (`gift-lifecycle` "Deletion purge job"): every step is safe to repeat, and the
 * tombstone is written last, so a failed attempt leaves a `deleting` gift that a retry finishes.
 */
export function createGiftDeletionHandler({
  analytics,
  assets,
  gifts,
  storage,
}: Dependencies): JobHandler<{ giftId: string }> {
  return {
    maxAttempts: 8,
    payload: z.object({ giftId: z.uuid() }).strict(),
    async run({ giftId }, { jobId, now }) {
      const gift = await gifts.findDeleting(giftId);
      // Already purged (a duplicate run) or never deleted: nothing to do.
      if (!gift) return;

      const photos = await assets.listForGift(gift.id);
      let storageFailed = false;
      for (const asset of photos) {
        if (asset.status === "deleted") continue;
        if (asset.status !== "deleting") {
          // Taken meanwhile by another worker or the expired-asset cleanup: it finishes it.
          if (!(await assets.markGiftAssetDeleting(asset.id, gift.id, now))) continue;
        }
        const removals = await Promise.allSettled([
          storage.deleteObject(asset.sourceKey),
          ...asset.derivatives.map((derivative) => storage.deleteObject(derivative.key)),
        ]);
        if (removals.some((removal) => removal.status === "rejected")) {
          storageFailed = true;
          continue;
        }
        await assets.markDeleted(asset.id, now);
      }
      if (storageFailed) throw new JobFailure("STORAGE_DELETE_FAILED", true);

      await gifts.deleteDerived(gift.id, jobId);
      await analytics.deleteForGift(gift.id);
      await gifts.purge({
        photos: photos.length,
        published: gift.publishedAt !== undefined,
        tombstone: {
          createdAt: gift.createdAt,
          deletedAt: now,
          deletionRequestedAt: gift.deletionRequestedAt ?? now,
          expiresAt: new Date(now.getTime() + GIFT_TOMBSTONE_RETENTION_MILLISECONDS),
          id: gift.id,
          ownerId: gift.ownership.ownerId,
          publicId: gift.publicId,
          publishedAt: gift.publishedAt ?? null,
        },
      });
    },
    type: GIFT_DELETE_JOB,
  };
}
