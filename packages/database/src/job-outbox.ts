import "server-only";

import { randomUUID } from "node:crypto";
import { type ClientSession, type Db } from "mongodb";

import { COLLECTIONS } from "./collections";

/** A generic job record (`background-jobs`); `media.process.v1` keeps its own document shape. */
export type JobOutboxDocument = Readonly<{
  _id: string;
  attempts: number;
  availableAt: Date;
  createdAt: Date;
  deduplicationKey: string;
  lastErrorCode: string | null;
  /** Identifiers only, never gift content, tokens or URLs. */
  payload: Readonly<Record<string, string>>;
  status: "completed" | "dead" | "pending" | "processing";
  type: string;
  updatedAt: Date;
}>;

export type EnqueueJobInput = Readonly<{
  deduplicationKey: string;
  now: Date;
  payload: Readonly<Record<string, string>>;
  type: string;
}>;

/**
 * Inserts a `pending` job unless its deduplication key already exists, in which case nothing is
 * written and nothing fails. Pass the caller's session so the job commits with the state that
 * needs it, or aborts with it.
 */
export async function enqueueJob(
  database: Db,
  input: EnqueueJobInput,
  session?: ClientSession,
): Promise<void> {
  await database.collection<JobOutboxDocument>(COLLECTIONS.jobOutbox).updateOne(
    { deduplicationKey: input.deduplicationKey },
    {
      $setOnInsert: {
        _id: randomUUID(),
        attempts: 0,
        availableAt: input.now,
        createdAt: input.now,
        lastErrorCode: null,
        payload: input.payload,
        status: "pending",
        type: input.type,
        updatedAt: input.now,
      },
    },
    { upsert: true, ...(session ? { session } : {}) },
  );
}
