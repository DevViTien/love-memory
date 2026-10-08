import { COLLECTIONS, getDatabase, type JobOutboxDocument } from "@love-memory/database";

import { type JobOutboxRepository, type JobType } from "../application/job-registry";

/** A `processing` job without update for this long is a crashed worker's lease. */
export const JOB_LEASE_MILLISECONDS = 10 * 60 * 1000;

async function jobs() {
  return (await getDatabase()).collection<JobOutboxDocument>(COLLECTIONS.jobOutbox);
}

/**
 * The generic job outbox. Every query names the generic types it may touch, so `media.process.v1`
 * jobs in the same collection are never claimed, changed or counted here.
 */
export const mongoJobOutbox: JobOutboxRepository = {
  async claimNext(types, now) {
    if (types.length === 0) return null;
    const job = await (
      await jobs()
    ).findOneAndUpdate(
      {
        $or: [
          { availableAt: { $lte: now }, status: "pending" },
          {
            status: "processing",
            updatedAt: { $lte: new Date(now.getTime() - JOB_LEASE_MILLISECONDS) },
          },
        ],
        type: { $in: [...types] },
      },
      { $inc: { attempts: 1 }, $set: { status: "processing", updatedAt: now } },
      { returnDocument: "after", sort: { availableAt: 1, createdAt: 1 } },
    );
    return job
      ? { attempts: job.attempts, id: job._id, payload: job.payload, type: job.type as JobType }
      : null;
  },

  async complete(id, now) {
    await (
      await jobs()
    ).updateOne(
      { _id: id, status: "processing" },
      { $set: { lastErrorCode: null, status: "completed", updatedAt: now } },
    );
  },

  async hasOverdueJob(types, cutoff) {
    if (types.length === 0) return false;
    // Served by `job_outbox_available` (status, availableAt); returns no job content.
    const job = await (
      await jobs()
    ).findOne(
      { availableAt: { $lte: cutoff }, status: "pending", type: { $in: [...types] } },
      { projection: { _id: 1 } },
    );
    return job !== null;
  },

  async listDead(limit) {
    const dead = await (
      await jobs()
    )
      .find(
        { status: "dead" },
        { projection: { attempts: 1, lastErrorCode: 1, type: 1, updatedAt: 1 } },
      )
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();
    return dead.map((job) => ({
      attempts: job.attempts,
      id: job._id,
      lastErrorCode: job.lastErrorCode ?? null,
      type: job.type,
      updatedAt: job.updatedAt,
    }));
  },

  async markDead(id, code, now) {
    await (
      await jobs()
    ).updateOne(
      { _id: id, status: "processing" },
      { $set: { lastErrorCode: code, status: "dead", updatedAt: now } },
    );
  },

  async retryLater(id, code, availableAt, now) {
    await (
      await jobs()
    ).updateOne(
      { _id: id, status: "processing" },
      { $set: { availableAt, lastErrorCode: code, status: "pending", updatedAt: now } },
    );
  },

  async revive(id, now) {
    const collection = await jobs();
    const revived = await collection.updateOne(
      { _id: id, status: "dead" },
      { $set: { attempts: 0, availableAt: now, status: "pending", updatedAt: now } },
    );
    if (revived.modifiedCount === 1) return "revived";
    const existing = await collection.findOne({ _id: id }, { projection: { _id: 1 } });
    return existing ? "not-dead" : "not-found";
  },
};
