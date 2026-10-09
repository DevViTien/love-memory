import { COLLECTIONS, getDatabase } from "@love-memory/database";
import { type ClientSession, type Db } from "mongodb";

import { type AuditLogRepository, type AuditRecord } from "../application/audit";

export type AuditLogDocument = Omit<AuditRecord, "id"> & Readonly<{ _id: string }>;

function toDocument(record: AuditRecord): AuditLogDocument {
  const { id, ...fields } = record;
  return { _id: id, ...fields };
}

function toRecord(document: AuditLogDocument): AuditRecord {
  const { _id, ...fields } = document;
  return { ...fields, id: _id };
}

/** Inserts a record, in the caller's transaction when one is given (operator commands). */
export async function insertAuditRecord(
  database: Db,
  record: AuditRecord,
  session?: ClientSession,
): Promise<void> {
  await database
    .collection<AuditLogDocument>(COLLECTIONS.auditLog)
    .insertOne(toDocument(record), session ? { session } : {});
}

/** Append-only: insert and read, nothing else (`audit-log`). */
export const mongoAuditLog: AuditLogRepository = {
  async insert(record) {
    await insertAuditRecord(await getDatabase(), record);
  },

  async listLatest({ limit, targetId }) {
    const database = await getDatabase();
    // `audit_log_target_at` for one target, `audit_log_at` otherwise.
    const documents = await database
      .collection<AuditLogDocument>(COLLECTIONS.auditLog)
      .find(targetId ? { "target.id": targetId } : {})
      .sort({ at: -1 })
      .limit(limit)
      .toArray();
    return documents.map(toRecord);
  },
};
