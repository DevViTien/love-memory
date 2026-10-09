import { COLLECTIONS, getDatabase, getMongoClient } from "@love-memory/database";
import { type ClientSession, type Db } from "mongodb";

import { buildAuditRecord, type AuditInput } from "@/modules/admin/application/audit";
import { insertAuditRecord } from "@/modules/admin/infrastructure/mongo-audit-log";

import { type AbuseReport, type AbuseReportStore } from "../application/abuse-reports";
import { type ModerationRepository, type ReportedGiftState } from "../application/moderation";

type AbuseReportDocument = Omit<AbuseReport, "id"> &
  Readonly<{ _id: string; resolvedAt?: Date | null }>;

type GiftStateDocument = Readonly<{
  _id: string;
  publicId: string;
  status: string;
  takedown?: Readonly<{ at: Date; by: string; reason: string }>;
}>;

/** The actor of an emergency takedown (`abuse-reports` "Emergency takedown"). */
export const EMERGENCY_ACTOR_ID = "abuse-report";

function toReport(document: AbuseReportDocument): AbuseReport {
  return {
    category: document.category,
    createdAt: document.createdAt,
    details: document.details,
    expiresAt: document.expiresAt,
    giftId: document.giftId,
    id: document._id,
    severity: document.severity,
    severityRank: document.severityRank,
    status: document.status,
    updatedAt: document.updatedAt,
  };
}

/**
 * Pauses a live gift on behalf of the operations team, unless it already holds a takedown. A
 * pipeline keeps an owner's earlier `pausedAt`. `true` when the gift now holds this takedown.
 */
async function applyTakedown(
  database: Db,
  input: Readonly<{ by: "admin" | "system"; giftId: string; now: Date; reason: string }>,
  session: ClientSession,
): Promise<boolean> {
  const result = await database.collection<GiftStateDocument>(COLLECTIONS.gifts).updateOne(
    {
      _id: input.giftId,
      status: { $in: ["published", "paused"] },
      takedown: { $exists: false },
    },
    [
      {
        $set: {
          pausedAt: { $ifNull: ["$pausedAt", input.now] },
          status: "paused",
          takedown: { at: input.now, by: input.by, reason: input.reason },
          updatedAt: input.now,
        },
      },
    ],
    { session },
  );
  return result.modifiedCount === 1;
}

async function findGiftState(
  database: Db,
  giftId: string,
  session: ClientSession,
): Promise<GiftStateDocument | null> {
  return database
    .collection<GiftStateDocument>(COLLECTIONS.gifts)
    .findOne(
      { _id: giftId, status: { $in: ["published", "paused"] } },
      { projection: { _id: 1, publicId: 1, status: 1, takedown: 1 }, session },
    );
}

function audit(input: AuditInput, requestId: string | null, now: Date) {
  return buildAuditRecord(input, requestId, now);
}

async function inTransaction(work: (database: Db, session: ClientSession) => Promise<void>) {
  const [database, client] = await Promise.all([getDatabase(), getMongoClient()]);
  await client.withSession((session) => session.withTransaction(() => work(database, session)));
}

async function closeOpenReports(
  database: Db,
  giftId: string,
  status: "actioned" | "dismissed",
  now: Date,
  session: ClientSession,
): Promise<void> {
  await database
    .collection<AbuseReportDocument>(COLLECTIONS.abuseReports)
    .updateMany(
      { giftId, status: "open" },
      { $set: { resolvedAt: now, status, updatedAt: now } },
      { session },
    );
}

export const mongoAbuseReportStore: AbuseReportStore = {
  async insertReport({ emergency, report }) {
    await inTransaction(async (database, session) => {
      const { id, ...fields } = report;
      await database
        .collection<AbuseReportDocument>(COLLECTIONS.abuseReports)
        .insertOne({ _id: id, ...fields }, { session });
      if (!emergency) return;
      const takenDown = await applyTakedown(
        database,
        { by: "system", giftId: report.giftId, now: report.createdAt, reason: report.category },
        session,
      );
      if (!takenDown) return;
      await insertAuditRecord(
        database,
        audit(
          {
            action: "gift.taken_down",
            actor: { id: EMERGENCY_ACTOR_ID, kind: "system" },
            metadata: { reason: report.category },
            target: { id: report.giftId, kind: "gift" },
          },
          null,
          report.createdAt,
        ),
        session,
      );
    });
  },
};

export const mongoModerationRepository: ModerationRepository = {
  async countOpenByGift(giftIds) {
    if (giftIds.length === 0) return new Map();
    const counts = await (
      await getDatabase()
    )
      .collection<AbuseReportDocument>(COLLECTIONS.abuseReports)
      .aggregate<{ _id: string; count: number }>([
        { $match: { giftId: { $in: [...giftIds] }, status: "open" } },
        { $group: { _id: "$giftId", count: { $sum: 1 } } },
      ])
      .toArray();
    return new Map(counts.map((entry) => [entry._id, entry.count]));
  },

  async dismiss({ actorId, now, report, requestId }) {
    await inTransaction(async (database, session) => {
      await database
        .collection<AbuseReportDocument>(COLLECTIONS.abuseReports)
        .updateOne(
          { _id: report.id, status: "open" },
          { $set: { resolvedAt: now, status: "dismissed", updatedAt: now } },
          { session },
        );
      await insertAuditRecord(
        database,
        audit(
          {
            action: "admin.report.dismissed",
            actor: { id: actorId, kind: "admin" },
            metadata: { reason: report.category },
            target: { id: report.id, kind: "report" },
          },
          requestId,
          now,
        ),
        session,
      );
    });
  },

  async findGiftStates(giftIds) {
    const states = new Map<string, ReportedGiftState>();
    if (giftIds.length === 0) return states;
    const database = await getDatabase();
    const [gifts, tombstones] = await Promise.all([
      database
        .collection<GiftStateDocument>(COLLECTIONS.gifts)
        .find(
          { _id: { $in: [...giftIds] } },
          { projection: { _id: 1, publicId: 1, status: 1, takedown: 1 } },
        )
        .toArray(),
      database
        .collection<{ _id: string; publicId: string }>(COLLECTIONS.giftTombstones)
        .find({ _id: { $in: [...giftIds] } }, { projection: { _id: 1, publicId: 1 } })
        .toArray(),
    ]);
    for (const tombstone of tombstones) {
      states.set(tombstone._id, { gone: true, id: tombstone._id, publicId: tombstone.publicId });
    }
    for (const gift of gifts) {
      states.set(
        gift._id,
        gift.status === "deleting"
          ? { gone: true, id: gift._id, publicId: gift.publicId }
          : {
              gone: false,
              id: gift._id,
              publicId: gift.publicId,
              status: gift.status,
              takenDown: gift.takedown !== undefined,
            },
      );
    }
    return states;
  },

  async findReport(reportId) {
    const document = await (
      await getDatabase()
    )
      .collection<AbuseReportDocument>(COLLECTIONS.abuseReports)
      .findOne({ _id: reportId });
    return document ? toReport(document) : null;
  },

  async listOpen(limit) {
    const documents = await (
      await getDatabase()
    )
      .collection<AbuseReportDocument>(COLLECTIONS.abuseReports)
      .find({ status: "open" })
      .sort({ severityRank: 1, createdAt: -1 })
      .limit(limit)
      .toArray();
    return documents.map(toReport);
  },

  async restore({ actorId, now, report, requestId }) {
    let outcome: "done" | "gift-gone" | "not-taken-down" = "done";
    await inTransaction(async (database, session) => {
      const gift = await findGiftState(database, report.giftId, session);
      if (!gift) {
        outcome = "gift-gone";
        return;
      }
      if (!gift.takedown || gift.status !== "paused") {
        outcome = "not-taken-down";
        return;
      }
      outcome = "done";
      // Published again only while the entitlement lasts; otherwise it stays paused (`abuse-reports`).
      const live = { $gt: ["$expiresAt", now] };
      await database.collection<GiftStateDocument>(COLLECTIONS.gifts).updateOne(
        { _id: gift._id, status: "paused", takedown: { $exists: true } },
        [
          {
            $set: {
              pausedAt: { $cond: [live, "$$REMOVE", "$pausedAt"] },
              status: { $cond: [live, "published", "paused"] },
              takedown: "$$REMOVE",
              updatedAt: now,
            },
          },
        ],
        { session },
      );
      await closeOpenReports(database, gift._id, "dismissed", now, session);
      await insertAuditRecord(
        database,
        audit(
          {
            action: "admin.gift.restored",
            actor: { id: actorId, kind: "admin" },
            metadata: { reportId: report.id },
            target: { id: gift._id, kind: "gift" },
          },
          requestId,
          now,
        ),
        session,
      );
    });
    return outcome;
  },

  async takeDown({ actorId, now, report, requestId }) {
    let outcome: "done" | "gift-gone" = "done";
    await inTransaction(async (database, session) => {
      const gift = await findGiftState(database, report.giftId, session);
      if (!gift) {
        outcome = "gift-gone";
        return;
      }
      outcome = "done";
      await applyTakedown(
        database,
        { by: "admin", giftId: gift._id, now, reason: report.category },
        session,
      );
      await closeOpenReports(database, gift._id, "actioned", now, session);
      await insertAuditRecord(
        database,
        audit(
          {
            action: "admin.gift.taken_down",
            actor: { id: actorId, kind: "admin" },
            metadata: { reason: report.category, reportId: report.id },
            target: { id: gift._id, kind: "gift" },
          },
          requestId,
          now,
        ),
        session,
      );
    });
    return outcome;
  },
};
