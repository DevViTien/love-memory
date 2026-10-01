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
  async findByShareId(shareId) {
    const database = await getDatabase();
    const document = await database
      .collection<GiftPublicationDocument>(COLLECTIONS.giftPublications)
      .findOne({ shareId: { $eq: shareId } });
    return document ? toPublicationDomain(document) : null;
  },
};
