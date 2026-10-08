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

/** Publication records are written only by the publish transaction and never updated. */
export const mongoGiftPublicationRepository: GiftPublicationRepository = {
  async findByGiftRevision(giftId, revision) {
    const database = await getDatabase();
    // Served by `gift_publications_gift_revision_unique`.
    const document = await database
      .collection<GiftPublicationDocument>(COLLECTIONS.giftPublications)
      .findOne({ giftId: { $eq: giftId }, revision: { $eq: revision } });
    return document ? toPublicationDomain(document) : null;
  },
};
