import "server-only";

import { COLLECTIONS, getDatabase } from "@love-memory/database";

import { type AnalyticsEventRecord } from "../application/analytics-event";
import { type AnalyticsEventRepository } from "../application/analytics-service";

/** One best-effort insert per event; analytics documents are never read back by a route. */
export const mongoAnalyticsEventRepository: AnalyticsEventRepository = {
  async insert(record) {
    const database = await getDatabase();
    await database.collection<AnalyticsEventRecord>(COLLECTIONS.analyticsEvents).insertOne(record);
  },
};
