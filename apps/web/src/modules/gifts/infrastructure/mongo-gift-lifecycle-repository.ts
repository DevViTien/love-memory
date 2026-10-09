import { COLLECTIONS, enqueueJob, getDatabase, getMongoClient } from "@love-memory/database";
import { type Gift } from "@love-memory/domain";

import {
  GIFT_DELETE_JOB,
  giftDeleteJobKey,
  type GiftLifecycleRepository,
} from "../application/gift-lifecycle";
import { mongoGiftRepository } from "./mongo-gift-repository";

type GiftStatusDocument = Readonly<{
  _id: string;
  deletionRequestedAt?: Date;
  expiresAt?: Date;
  pausedAt?: Date;
  status: Gift["status"];
  updatedAt: Date;
}>;

async function gifts() {
  return (await getDatabase()).collection<GiftStatusDocument>(COLLECTIONS.gifts);
}

/** `gift-lifecycle`: conditional status writes; the owner filter ran in `findAuthorized`. */
export const mongoGiftLifecycleRepository: GiftLifecycleRepository = {
  findAuthorized: (publicId, accessors) => mongoGiftRepository.findAuthorized(publicId, accessors),

  async pause(giftId, now) {
    const result = await (
      await gifts()
    ).updateOne(
      { _id: giftId, status: "published" },
      { $set: { pausedAt: now, status: "paused", updatedAt: now } },
    );
    return result.modifiedCount === 1;
  },

  async requestDeletion(giftId, now) {
    const [database, client] = await Promise.all([getDatabase(), getMongoClient()]);
    let changed = false;
    await client.withSession((session) =>
      session.withTransaction(async () => {
        changed = false;
        const result = await database.collection<GiftStatusDocument>(COLLECTIONS.gifts).updateOne(
          { _id: giftId, status: { $in: ["draft", "published", "paused"] } },
          {
            $set: { deletionRequestedAt: now, status: "deleting", updatedAt: now },
            $unset: { pausedAt: "" },
          },
          { session },
        );
        if (result.modifiedCount === 0) return;
        // The purge is committed with the request: a lost dispatch never loses it.
        await enqueueJob(
          database,
          {
            deduplicationKey: giftDeleteJobKey(giftId),
            now,
            payload: { giftId },
            type: GIFT_DELETE_JOB,
          },
          session,
        );
        changed = true;
      }),
    );
    return changed;
  },

  async resume(giftId, now) {
    const result = await (
      await gifts()
    ).updateOne(
      { _id: giftId, expiresAt: { $gt: now }, status: "paused" },
      { $set: { status: "published", updatedAt: now }, $unset: { pausedAt: "" } },
    );
    return result.modifiedCount === 1;
  },
};
