import { type JobRunner, type JobStepOutcome } from "./job-runner";

/** Worker steps one `jobs-drain` or `jobs-sweep` run handles before handing over. */
export const JOBS_DRAIN_BATCH_SIZE = 10;

export type JobsDrainSummary = Readonly<{
  continuationScheduled: boolean;
  handled: number;
  source: string;
  summary: Readonly<Partial<Record<JobStepOutcome, number>>>;
}>;

/**
 * One drain (`background-jobs`): at most one batch of steps, then a continuation when the batch
 * was full, so a burst never waits for the next sweep. The summary holds counts only.
 */
export async function drainJobs(
  runner: Pick<JobRunner, "runAvailable">,
  scheduleContinuation: () => Promise<void>,
  source: string,
): Promise<JobsDrainSummary> {
  const results = await runner.runAvailable(JOBS_DRAIN_BATCH_SIZE);
  const summary: Partial<Record<JobStepOutcome, number>> = {};
  for (const result of results) summary[result.outcome] = (summary[result.outcome] ?? 0) + 1;
  const continuationScheduled = results.length === JOBS_DRAIN_BATCH_SIZE;
  if (continuationScheduled) await scheduleContinuation();
  return { continuationScheduled, handled: results.length, source, summary };
}
