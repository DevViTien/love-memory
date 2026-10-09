import { COLLECTIONS, getDatabase, getMongoClient } from "@love-memory/database";

import { type AdminStepUpRepository } from "../application/admin-access";
import { insertAuditRecord } from "./mongo-audit-log";

type AdminStepUpDocument = Readonly<{
  _id: string;
  expiresAt: Date;
  userId: string;
  verifiedAt: Date;
}>;

/** One step-up per session (`_id` is the session id's hash); expired ones are removed by TTL. */
export const mongoAdminStepUps: AdminStepUpRepository = {
  async hasValid(sessionKey, userId, now) {
    const stepUp = await (
      await getDatabase()
    )
      .collection<AdminStepUpDocument>(COLLECTIONS.adminStepUps)
      .findOne({ _id: sessionKey, expiresAt: { $gt: now }, userId }, { projection: { _id: 1 } });
    return stepUp !== null;
  },

  async record(stepUp, audit) {
    const [database, client] = await Promise.all([getDatabase(), getMongoClient()]);
    await client.withSession((session) =>
      session.withTransaction(async () => {
        await database
          .collection<AdminStepUpDocument>(COLLECTIONS.adminStepUps)
          .replaceOne(
            { _id: stepUp.key },
            { expiresAt: stepUp.expiresAt, userId: stepUp.userId, verifiedAt: stepUp.verifiedAt },
            { session, upsert: true },
          );
        await insertAuditRecord(database, audit, session);
      }),
    );
  },
};
