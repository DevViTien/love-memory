import { COLLECTIONS, getDatabase } from "@love-memory/database";
import { GiftPublicationSchema, type GiftPublication } from "@love-memory/domain";

import { type GiftPublicationRepository } from "../application/gift-service";

export type GiftPublicationDocument = Omit<GiftPublication, "id"> & Readonly<{ _id: string }>;

export function toPublicationDocument(publication: GiftPublication): GiftPublicationDocument {
  const { id, ...document } = publication;
  return { _id: id, ...document };
}

export function toPublicationDomain(document: GiftPublicationDocument): GiftPublication {
  const { _id, ...publication } = document;
  return GiftPublicationSchema.parse({ ...publication, id: _id });
}

/**
 * Publication records are written only by the publish transaction and never updated. Superseded
 * ones are deleted by `gift.assets.cleanup.v1` once a newer one is current.
 */
export const mongoGiftPublicationRepository: GiftPublicationRepository &
  Readonly<{ deleteSuperseded: (giftId: string, currentRevision: number) => Promise<void> }> = {
  async deleteSuperseded(giftId, currentRevision) {
    const database = await getDatabase();
    // Served by `gift_publications_gift_revision_unique` (prefix `giftId`).
    await database
      .collection<GiftPublicationDocument>(COLLECTIONS.giftPublications)
      .deleteMany({ giftId: { $eq: giftId }, revision: { $lt: currentRevision } });
  },

  async findByGiftRevision(giftId, revision) {
    const database = await getDatabase();
    // Served by `gift_publications_gift_revision_unique`.
    const document = await database
      .collection<GiftPublicationDocument>(COLLECTIONS.giftPublications)
      .findOne({ giftId: { $eq: giftId }, revision: { $eq: revision } });
    return document ? toPublicationDomain(document) : null;
  },
};
