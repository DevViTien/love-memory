import { logger, queue, schedules, task, tasks } from "@trigger.dev/sdk";

import { getJobRunner } from "@/composition/jobs";
import { drainJobs } from "@/modules/jobs/application/jobs-drain";

type DrainPayload = Readonly<{ source?: "backlog" | "dispatch" }>;

const jobsQueue = queue({ concurrencyLimit: 1, name: "jobs" });

async function drain(source: string) {
  const result = await drainJobs(
    getJobRunner(),
    async () => {
      await tasks.trigger("jobs-drain", { source: "backlog" } satisfies DrainPayload);
    },
    source,
  );
  // Counts only: never a payload, a job id list or gift content.
  logger.info("Job outbox drained", result);
  return result;
}

export const jobsDrainTask = task({
  id: "jobs-drain",
  maxDuration: 300,
  queue: jobsQueue,
  retry: { maxAttempts: 3 },
  run: async (payload: DrainPayload) => drain(payload.source ?? "dispatch"),
});

/** Picks up work whose dispatch was lost, at most five minutes later. */
export const jobsSweepTask = schedules.task({
  id: "jobs-sweep",
  cron: "*/5 * * * *",
  maxDuration: 300,
  queue: jobsQueue,
  retry: { maxAttempts: 3 },
  run: async () => drain("scheduled-sweep"),
});
