import "server-only";

import { COLLECTIONS, getDatabase } from "@love-memory/database";

import { type PreviewTokenRepository } from "../application/preview-service";

/** `_id` is the token's SHA-256 hash; the token itself is never stored. */
type PreviewTokenDocument = Readonly<{
  _id: string;
  createdAt: Date;
  expiresAt: Date;
  giftId: string;
}>;

export const mongoPreviewTokenRepository: PreviewTokenRepository = {
  async findActive(tokenHash, now) {
    const database = await getDatabase();
    // The TTL monitor runs about once a minute, so expiry is enforced by the filter itself.
    const document = await database
      .collection<PreviewTokenDocument>(COLLECTIONS.previewTokens)
      .findOne({ _id: tokenHash, expiresAt: { $gt: now } });

    return document ? { expiresAt: document.expiresAt, giftId: document.giftId } : null;
  },

  async insert(record) {
    const database = await getDatabase();
    await database.collection<PreviewTokenDocument>(COLLECTIONS.previewTokens).insertOne({
      _id: record.tokenHash,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      giftId: record.giftId,
    });
  },
};
