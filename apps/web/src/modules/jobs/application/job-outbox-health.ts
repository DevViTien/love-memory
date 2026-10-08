import { type JobOutboxRepository, type JobType } from "./job-registry";

/** A due generic job older than this means neither a dispatched drain nor `jobs-sweep` is running. */
export const JOB_OUTBOX_STALL_THRESHOLD_MILLISECONDS = 10 * 60 * 1000;

/** Named in the readiness log only; the readiness response itself stays generic. */
export class JobOutboxStalledError extends Error {
  constructor() {
    super("A background job has been waiting longer than the stall threshold.");
    this.name = "JobOutboxStalledError";
  }
}

export async function assertJobOutboxFlowing({
  monitor,
  now = new Date(),
  types,
}: Readonly<{
  monitor: Pick<JobOutboxRepository, "hasOverdueJob">;
  now?: Date;
  types: readonly JobType[];
}>): Promise<void> {
  const cutoff = new Date(now.getTime() - JOB_OUTBOX_STALL_THRESHOLD_MILLISECONDS);
  if (await monitor.hasOverdueJob(types, cutoff)) throw new JobOutboxStalledError();
}
