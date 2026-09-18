import { logger, queue, schedules, task, tasks } from "@trigger.dev/sdk";

import { getMediaWorker } from "@/composition/media";

type DrainPayload = Readonly<{ source: "backlog" | "retry" | "upload-complete" }>;

const mediaWorkerQueue = queue({ concurrencyLimit: 1, name: "media-worker" });
const drainBatchSize = 10;

async function drain(source: string) {
  const worker = getMediaWorker();
  const cleanup = source === "scheduled-sweep" ? await worker.runExpiredCleanup() : null;
  const results = await worker.runAvailable(drainBatchSize);
  const summary = results.reduce<Record<string, number>>((current, result) => {
    current[result.status] = (current[result.status] ?? 0) + 1;
    return current;
  }, {});
  const continuationScheduled = results.length === drainBatchSize;
  if (continuationScheduled) {
    await tasks.trigger("media-worker-drain", {
      source: "backlog" satisfies DrainPayload["source"],
    });
  }
  logger.info("Media outbox drained", {
    cleanup,
    continuationScheduled,
    handled: results.length,
    source,
    summary,
  });
  return { cleanup, continuationScheduled, handled: results.length, summary };
}

export const mediaWorkerDrainTask = task({
  id: "media-worker-drain",
  maxDuration: 300,
  queue: mediaWorkerQueue,
  retry: { maxAttempts: 3 },
  run: async (payload: DrainPayload) => drain(payload.source),
});

export const mediaWorkerSweepTask = schedules.task({
  id: "media-worker-sweep",
  cron: "*/5 * * * *",
  maxDuration: 300,
  queue: mediaWorkerQueue,
  retry: { maxAttempts: 3 },
  run: async () => drain("scheduled-sweep"),
});
