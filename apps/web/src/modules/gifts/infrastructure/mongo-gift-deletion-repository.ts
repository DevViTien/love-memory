import { COLLECTIONS, getDatabase, getMongoClient } from "@love-memory/database";

import { buildAuditRecord } from "@/modules/admin/application/audit";
import { insertAuditRecord } from "@/modules/admin/infrastructure/mongo-audit-log";

import { type GiftDeletionRepository, type GiftTombstone } from "../application/gift-deletion";
import { GIFT_DELETE_JOB } from "../application/gift-lifecycle";
import { findDeletingGift } from "./mongo-gift-repository";

type GiftTombstoneDocument = Omit<GiftTombstone, "id"> & Readonly<{ _id: string }>;

/** The collections that hold records derived from one gift, keyed by `giftId`. */
const DERIVED_COLLECTIONS = [
  COLLECTIONS.giftRevisions,
  COLLECTIONS.giftPublications,
  COLLECTIONS.previewTokens,
  COLLECTIONS.idempotencyKeys,
] as const;

export const mongoGiftDeletionRepository: GiftDeletionRepository = {
  findDeleting: (giftId) => findDeletingGift(giftId),

  async deleteDerived(giftId, runningJobId) {
    const database = await getDatabase();
    await Promise.all([
      ...DERIVED_COLLECTIONS.map((name) => database.collection(name).deleteMany({ giftId })),
      // Other jobs of the gift (a pending cleanup), never this one or one a worker holds.
      database.collection<{ _id: string }>(COLLECTIONS.jobOutbox).deleteMany({
        _id: { $ne: runningJobId },
        "payload.giftId": giftId,
        status: { $ne: "processing" },
      }),
    ]);
  },

  async purge({ photos, published, tombstone }) {
    const [database, client] = await Promise.all([getDatabase(), getMongoClient()]);
    const { id, ...fields } = tombstone;
    await client.withSession((session) =>
      session.withTransaction(async () => {
        await database
          .collection<GiftTombstoneDocument>(COLLECTIONS.giftTombstones)
          .replaceOne({ _id: id }, fields, { session, upsert: true });
        const removed = await database
          .collection<{ _id: string; status: string }>(COLLECTIONS.gifts)
          .deleteOne({ _id: id, status: "deleting" }, { session });
        // A repeat after a committed purge removes nothing and records nothing new.
        if (removed.deletedCount === 0) return;
        await insertAuditRecord(
          database,
          buildAuditRecord(
            {
              action: "gift.deleted",
              actor: { id: GIFT_DELETE_JOB, kind: "system" },
              metadata: { photos, published },
              target: { id, kind: "gift" },
            },
            null,
            tombstone.deletedAt,
          ),
          session,
        );
      }),
    );
  },
};
