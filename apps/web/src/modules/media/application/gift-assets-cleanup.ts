import { type Gift, type GiftPublication, type MediaAsset } from "@love-memory/domain";
import { type ObjectStorage } from "@love-memory/storage";
import { z } from "zod";

import { type JobHandler, JobFailure } from "@/modules/jobs/application/job-registry";

export const GIFT_ASSETS_CLEANUP_JOB = "gift.assets.cleanup.v1";

/** One job per published revision of a gift (`gift-publishing`, `media-upload`). */
export function giftAssetsCleanupKey(giftId: string, revision: number): string {
  return `${GIFT_ASSETS_CLEANUP_JOB}:${giftId}:${revision}`;
}

/** Detached assets and the conditional moves that retire them. */
export interface DetachedAssetRepository {
  /** `ready` assets of the gift with `detachedAt` set. */
  listDetachedReady(giftId: string): Promise<readonly MediaAsset[]>;
  /** `ready` and detached → `deleting`; `false` when the asset no longer matches. */
  markDetachedDeleting(assetId: string, giftId: string, now: Date): Promise<boolean>;
  markDeleted(assetId: string, now: Date): Promise<boolean>;
}

type Dependencies = Readonly<{
  assets: DetachedAssetRepository;
  gifts: Readonly<{ findEditableById: (giftId: string) => Promise<Gift | null> }>;
  publications: Readonly<{
    findByGiftRevision: (giftId: string, revision: number) => Promise<GiftPublication | null>;
  }>;
  storage: Pick<ObjectStorage, "deleteObject">;
}>;

/**
 * `gift.assets.cleanup.v1` (`media-upload` "Cleanup of detached assets"): deletes the detached
 * photos of a published gift that its current publication no longer references, the way a user
 * deletion does. A detached asset can never be referenced by a save again, so no later publication
 * can need it. Idempotent: a second run selects nothing.
 */
export function createGiftAssetsCleanupHandler({
  assets,
  gifts,
  publications,
  storage,
}: Dependencies): JobHandler<{ giftId: string }> {
  return {
    maxAttempts: 5,
    payload: z.object({ giftId: z.uuid() }).strict(),
    async run({ giftId }, { now }) {
      const gift = await gifts.findEditableById(giftId);
      if (gift?.status !== "published" || gift.publishedRevision === undefined) return;
      const current = await publications.findByGiftRevision(gift.id, gift.publishedRevision);
      // Without a readable current publication nothing proves a photo unused: retry later.
      if (!current) throw new JobFailure("PUBLICATION_UNREADABLE", true);

      const served = new Set(current.assetIds);
      const unused = (await assets.listDetachedReady(gift.id)).filter(
        (asset) => !served.has(asset.id),
      );
      let storageFailed = false;
      for (const asset of unused) {
        // Another worker, or the expired-asset cleanup, may have taken it already.
        if (!(await assets.markDetachedDeleting(asset.id, gift.id, now))) continue;
        const removals = await Promise.allSettled([
          storage.deleteObject(asset.sourceKey),
          ...asset.derivatives.map((derivative) => storage.deleteObject(derivative.key)),
        ]);
        if (removals.some((removal) => removal.status === "rejected")) {
          // Stays `deleting`: the next attempt or the expired-asset cleanup finishes it.
          storageFailed = true;
          continue;
        }
        await assets.markDeleted(asset.id, now);
      }
      if (storageFailed) throw new JobFailure("STORAGE_DELETE_FAILED", true);
    },
    type: GIFT_ASSETS_CLEANUP_JOB,
  };
}
