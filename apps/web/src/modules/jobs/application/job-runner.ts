import {
  type AnyJobHandler,
  JobFailure,
  type JobOutboxRepository,
  type JobType,
} from "./job-registry";

export const JOB_RETRY_BASE_MILLISECONDS = 30_000;
export const JOB_RETRY_MAX_MILLISECONDS = 3_600_000;

export type JobStepOutcome = "completed" | "dead" | "idle" | "retrying";

export type JobStepResult = Readonly<{
  id: string | null;
  outcome: JobStepOutcome;
  type: JobType | null;
}>;

/** What a failure log may hold: never the payload, an error message or gift content. */
export type JobFailureLog = Readonly<{
  attempts: number;
  code: string;
  jobId: string;
  type: JobType;
}>;

type Dependencies = Readonly<{
  clock?: () => Date;
  handlers: readonly AnyJobHandler[];
  logFailure?: (entry: JobFailureLog) => void;
  repository: JobOutboxRepository;
}>;

/** `2^attempts × 30 s`, at most one hour: 60 s after the first attempt, 120 s after the second. */
export function retryDelayMilliseconds(attempts: number): number {
  return Math.min(2 ** attempts * JOB_RETRY_BASE_MILLISECONDS, JOB_RETRY_MAX_MILLISECONDS);
}

/**
 * Runs generic jobs (`background-jobs`): claim, validate the payload, run the idempotent handler,
 * then complete, retry later with backoff, or move the job to `dead` with an error code.
 */
export function createJobRunner({
  clock = () => new Date(),
  handlers,
  logFailure = () => undefined,
  repository,
}: Dependencies) {
  const byType = new Map(handlers.map((handler) => [handler.type, handler] as const));
  const types = [...byType.keys()];

  async function fail(
    job: Readonly<{ attempts: number; id: string; type: JobType }>,
    handler: AnyJobHandler,
    code: string,
    retryable: boolean,
  ): Promise<JobStepResult> {
    const now = clock();
    logFailure({ attempts: job.attempts, code, jobId: job.id, type: job.type });
    if (retryable && job.attempts < handler.maxAttempts) {
      const availableAt = new Date(now.getTime() + retryDelayMilliseconds(job.attempts));
      await repository.retryLater(job.id, code, availableAt, now);
      return { id: job.id, outcome: "retrying", type: job.type };
    }
    await repository.markDead(job.id, code, now);
    return { id: job.id, outcome: "dead", type: job.type };
  }

  async function runStep(): Promise<JobStepResult> {
    const job = await repository.claimNext(types, clock());
    if (!job) return { id: null, outcome: "idle", type: null };

    const handler = byType.get(job.type);
    // Claiming filters on the registered types, so this only guards a misbehaving repository.
    if (!handler) throw new Error(`No handler for claimed job type ${job.type}.`);

    // Only a crashed lease gets past the budget: the claim already counted the lost attempt.
    if (job.attempts > handler.maxAttempts) return fail(job, handler, "LEASE_EXPIRED", false);

    const payload = handler.payload.safeParse(job.payload);
    if (!payload.success) return fail(job, handler, "INVALID_PAYLOAD", false);

    try {
      await handler.run(payload.data as never, { jobId: job.id, now: clock() });
    } catch (error) {
      return error instanceof JobFailure
        ? fail(job, handler, error.code, error.retryable)
        : fail(job, handler, "JOB_FAILED", true);
    }
    await repository.complete(job.id, clock());
    return { id: job.id, outcome: "completed", type: job.type };
  }

  async function runAvailable(limit: number): Promise<JobStepResult[]> {
    const results: JobStepResult[] = [];
    while (results.length < limit) {
      const result = await runStep();
      if (result.outcome === "idle") break;
      results.push(result);
    }
    return results;
  }

  return { registeredTypes: types, runAvailable, runStep } as const;
}

export type JobRunner = ReturnType<typeof createJobRunner>;
