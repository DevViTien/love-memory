import { COLLECTIONS, getDatabase } from "@love-memory/database";
import { type UUID } from "mongodb";

import {
  type AdminGiftLookupRepository,
  type AdminGiftSummary,
  type AdminGiftTombstone,
} from "../application/gift-lookup";
import { authIdFilter } from "./better-auth-ids";

/** Only the fields the summary shows are read: content never leaves the database. */
type GiftSummaryDocument = Readonly<{
  _id: string;
  content: Readonly<{ templateId: string; templateVersion: string }>;
  createdAt: Date;
  entitlement?: Readonly<{ planId: string }>;
  expiresAt?: Date;
  ownership: Readonly<{ ownerId: string | null }>;
  publicId: string;
  publishedAt?: Date;
  publishedRevision?: number;
  revision: number;
  status: string;
  updatedAt: Date;
}>;

const SUMMARY_PROJECTION = {
  _id: 1,
  "content.templateId": 1,
  "content.templateVersion": 1,
  createdAt: 1,
  "entitlement.planId": 1,
  expiresAt: 1,
  "ownership.ownerId": 1,
  publicId: 1,
  publishedAt: 1,
  publishedRevision: 1,
  revision: 1,
  status: 1,
  updatedAt: 1,
} as const;

/**
 * Admin-only, cross-owner reads of `gifts`, `users` and `assets` (design Decision 5); no creator
 * repository gains a cross-owner method. Each branch of the match is served by a unique index.
 */
type GiftTombstoneDocument = Omit<AdminGiftTombstone, "id"> & Readonly<{ _id: string }>;

export const mongoAdminGiftLookup: AdminGiftLookupRepository = {
  async findTombstone(query) {
    const database = await getDatabase();
    // `_id` and `gift_tombstones_public_id` serve the two branches; a share id never matches.
    const tombstone = await database
      .collection<GiftTombstoneDocument>(COLLECTIONS.giftTombstones)
      .findOne(
        { $or: [{ _id: query }, { publicId: query }] },
        {
          projection: {
            _id: 1,
            createdAt: 1,
            deletedAt: 1,
            deletionRequestedAt: 1,
            ownerId: 1,
            publicId: 1,
            publishedAt: 1,
          },
        },
      );
    if (!tombstone) return null;
    return {
      createdAt: tombstone.createdAt,
      deletedAt: tombstone.deletedAt,
      deletionRequestedAt: tombstone.deletionRequestedAt,
      id: tombstone._id,
      ownerId: tombstone.ownerId,
      publicId: tombstone.publicId,
      publishedAt: tombstone.publishedAt,
    };
  },

  async findSummary(query) {
    const database = await getDatabase();
    const gift = await database.collection<GiftSummaryDocument>(COLLECTIONS.gifts).findOne(
      {
        $or: [{ _id: query }, { publicId: query }, { shareId: { $eq: query, $type: "string" } }],
      },
      { projection: SUMMARY_PROJECTION },
    );
    if (!gift) return null;

    const ownerId = gift.ownership.ownerId;
    const [owner, counts] = await Promise.all([
      ownerId
        ? database
            .collection<{ _id: string | UUID; email: string }>(COLLECTIONS.users)
            .findOne({ _id: authIdFilter(ownerId) }, { projection: { _id: 0, email: 1 } })
        : Promise.resolve(null),
      database
        .collection(COLLECTIONS.assets)
        .aggregate<{ _id: string; count: number }>([
          { $match: { giftId: gift._id } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ])
        .toArray(),
    ]);

    const summary: AdminGiftSummary = {
      assetCounts: Object.fromEntries(counts.map((entry) => [entry._id, entry.count])),
      createdAt: gift.createdAt,
      expiresAt: gift.expiresAt ?? null,
      id: gift._id,
      owner: ownerId
        ? { email: owner?.email ?? null, id: ownerId, kind: "user" }
        : { kind: "anonymous" },
      planId: gift.entitlement?.planId ?? null,
      publicId: gift.publicId,
      publishedAt: gift.publishedAt ?? null,
      publishedRevision: gift.publishedRevision ?? null,
      revision: gift.revision,
      status: gift.status,
      templateId: gift.content.templateId,
      templateVersion: gift.content.templateVersion,
      updatedAt: gift.updatedAt,
    };
    return summary;
  },
};
