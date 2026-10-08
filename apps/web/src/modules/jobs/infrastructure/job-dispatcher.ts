import { idempotencyKeys, tasks } from "@trigger.dev/sdk";

import { type JobType } from "../application/job-registry";

/** Steps an `inline` dispatch runs after the request's transaction committed. */
export const INLINE_JOB_STEPS = 10;

export type JobDispatcher = Readonly<{
  /** Wakes a worker for `type`; never throws, never decides whether the work happens. */
  dispatch: (type: JobType) => Promise<void>;
}>;

type Dependencies = Readonly<{
  /** The worker mode of `media-processing` (`MEDIA_WORKER_MODE`), validated by the caller. */
  mode: () => "inline" | "trigger";
  reportFailure: (error: unknown) => void;
  runInline: (limit: number) => Promise<unknown>;
  trigger: (type: JobType) => Promise<void>;
}>;

/**
 * Dispatch after a commit (`background-jobs`): `inline` runs the steps now, `trigger` asks
 * Trigger.dev for a `jobs-drain`. The outbox stays the source of truth, so any failure here is
 * reported and swallowed: the sweep picks the work up later.
 */
export function createJobDispatcher({
  mode,
  reportFailure,
  runInline,
  trigger,
}: Dependencies): JobDispatcher {
  return {
    async dispatch(type) {
      try {
        if (mode() === "inline") {
          await runInline(INLINE_JOB_STEPS);
          return;
        }
        await trigger(type);
      } catch (error) {
        reportFailure(error);
      }
    },
  };
}

/** One `jobs-drain` per job type and 10-second window, however many requests enqueue work. */
export async function triggerJobsDrain(type: JobType, now: Date = new Date()): Promise<void> {
  const dispatchWindow = Math.floor(now.getTime() / 10_000);
  const idempotencyKey = await idempotencyKeys.create(`jobs-drain:${type}:${dispatchWindow}`, {
    scope: "global",
  });
  await tasks.trigger("jobs-drain", {}, { idempotencyKey, idempotencyKeyTTL: "1m" });
}
