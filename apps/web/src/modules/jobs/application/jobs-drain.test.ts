import { describe, expect, it, vi } from "vitest";

import { type JobStepResult } from "./job-runner";
import { drainJobs, JOBS_DRAIN_BATCH_SIZE } from "./jobs-drain";

const step = (outcome: JobStepResult["outcome"]): JobStepResult => ({
  id: "job",
  outcome,
  type: "gift.assets.cleanup.v1",
});

describe("jobs drain", () => {
  it("hands a full batch over to a continuation (Burst larger than one batch)", async () => {
    const runAvailable = vi.fn(() =>
      Promise.resolve([...Array.from({ length: 9 }, () => step("completed")), step("dead")]),
    );
    const scheduleContinuation = vi.fn(() => Promise.resolve());

    await expect(drainJobs({ runAvailable }, scheduleContinuation, "backlog")).resolves.toEqual({
      continuationScheduled: true,
      handled: 10,
      source: "backlog",
      summary: { completed: 9, dead: 1 },
    });
    expect(runAvailable).toHaveBeenCalledWith(JOBS_DRAIN_BATCH_SIZE);
    expect(scheduleContinuation).toHaveBeenCalledOnce();
  });

  it("stops after a partial batch", async () => {
    const scheduleContinuation = vi.fn(() => Promise.resolve());

    await expect(
      drainJobs(
        { runAvailable: () => Promise.resolve([step("retrying")]) },
        scheduleContinuation,
        "scheduled-sweep",
      ),
    ).resolves.toEqual({
      continuationScheduled: false,
      handled: 1,
      source: "scheduled-sweep",
      summary: { retrying: 1 },
    });
    expect(scheduleContinuation).not.toHaveBeenCalled();
  });
});
