import { type z } from "zod";

/** A generic job type: a name with a version suffix, so a payload change is a new type. */
export type JobType = `${string}.v${number}`;

export type JobContext = Readonly<{ jobId: string; now: Date }>;

/**
 * One generic job type (`background-jobs`). The payload holds identifiers only, and `run` MUST be
 * idempotent: a crashed worker's lease is claimed again and the handler runs a second time.
 */
export type JobHandler<P = unknown> = Readonly<{
  maxAttempts: number;
  payload: z.ZodType<P>;
  run: (payload: P, context: JobContext) => Promise<void>;
  type: JobType;
}>;

/**
 * Any handler, whatever its payload type: what the runner and the registry hold. The runner checks
 * each payload with the handler's own schema before calling `run`.
 */
export type AnyJobHandler = Readonly<{
  maxAttempts: number;
  payload: z.ZodType<unknown>;
  run: (payload: never, context: JobContext) => Promise<void>;
  type: JobType;
}>;

/** A failure a handler reports with its code; anything else thrown is `JOB_FAILED` (retryable). */
export class JobFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "JobFailure";
  }
}

export type ClaimedJob = Readonly<{
  attempts: number;
  id: string;
  payload: unknown;
  type: JobType;
}>;

export type DeadJob = Readonly<{
  attempts: number;
  id: string;
  lastErrorCode: string | null;
  type: string;
  updatedAt: Date;
}>;

export type ReviveOutcome = "not-dead" | "not-found" | "revived";

/** The job outbox for generic jobs; `media.process.v1` keeps its own repository. */
export interface JobOutboxRepository {
  /** The oldest due `pending` job, or a stale `processing` lease, of these types; `attempts` + 1. */
  claimNext(types: readonly JobType[], now: Date): Promise<ClaimedJob | null>;
  complete(id: string, now: Date): Promise<void>;
  hasOverdueJob(types: readonly JobType[], cutoff: Date): Promise<boolean>;
  listDead(limit: number): Promise<readonly DeadJob[]>;
  markDead(id: string, code: string, now: Date): Promise<void>;
  retryLater(id: string, code: string, availableAt: Date, now: Date): Promise<void>;
  /** A `dead` job back to `pending` with a fresh budget; nothing else is ever revived. */
  revive(id: string, now: Date): Promise<ReviveOutcome>;
}
