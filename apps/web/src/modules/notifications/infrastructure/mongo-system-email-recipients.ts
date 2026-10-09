import "server-only";

import { COLLECTIONS, getDatabase } from "@love-memory/database";
import { type UUID } from "mongodb";

import { authIdFilter } from "@/modules/admin/infrastructure/better-auth-ids";

import { type SystemEmailRecipients } from "../application/system-emails";

type GiftOwnerDocument = Readonly<{
  _id: string;
  ownership: Readonly<{ ownerId: string | null }>;
  publicId: string;
  status: string;
}>;

/** The gift's current owner, read at send time: an email never follows a stale address. */
export const mongoSystemEmailRecipients: SystemEmailRecipients = {
  async findForGift(giftId) {
    const database = await getDatabase();
    const gift = await database
      .collection<GiftOwnerDocument>(COLLECTIONS.gifts)
      .findOne(
        { _id: giftId, status: { $ne: "deleting" } },
        { projection: { _id: 1, "ownership.ownerId": 1, publicId: 1, status: 1 } },
      );
    const ownerId = gift?.ownership.ownerId;
    if (!gift || !ownerId) return null;
    const owner = await database
      .collection<{ _id: string | UUID; email?: string }>(COLLECTIONS.users)
      .findOne({ _id: authIdFilter(ownerId) }, { projection: { _id: 0, email: 1 } });
    return { email: owner?.email ?? null, publicId: gift.publicId };
  },
};
