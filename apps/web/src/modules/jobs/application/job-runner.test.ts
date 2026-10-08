import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  type ClaimedJob,
  JobFailure,
  type JobHandler,
  type JobOutboxRepository,
} from "./job-registry";
import { createJobRunner, type JobFailureLog, retryDelayMilliseconds } from "./job-runner";

const now = new Date("2026-10-08T10:00:00.000Z");
const giftId = "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89";

function fakeRepository(queue: ClaimedJob[]) {
  const calls: Array<[string, ...unknown[]]> = [];
  const repository: JobOutboxRepository = {
    claimNext: vi.fn((types) => {
      calls.push(["claimNext", types]);
      return Promise.resolve(queue.shift() ?? null);
    }),
    complete: vi.fn((id) => {
      calls.push(["complete", id]);
      return Promise.resolve();
    }),
    hasOverdueJob: vi.fn(() => Promise.resolve(false)),
    listDead: vi.fn(() => Promise.resolve([])),
    markDead: vi.fn((id, code) => {
      calls.push(["markDead", id, code]);
      return Promise.resolve();
    }),
    retryLater: vi.fn((id, code, availableAt) => {
      calls.push(["retryLater", id, code, availableAt]);
      return Promise.resolve();
    }),
    revive: vi.fn(() => Promise.resolve("revived" as const)),
  };
  return { calls, repository };
}

describe("job runner", () => {
  let run: ReturnType<typeof vi.fn<(payload: { giftId: string }) => Promise<void>>>;
  let handler: JobHandler<{ giftId: string }>;
  let logs: JobFailureLog[];

  beforeEach(() => {
    run = vi.fn(() => Promise.resolve());
    handler = {
      maxAttempts: 5,
      payload: z.object({ giftId: z.uuid() }).strict(),
      run,
      type: "gift.assets.cleanup.v1",
    };
    logs = [];
  });

  function runner(queue: ClaimedJob[]) {
    const fake = fakeRepository(queue);
    return {
      ...fake,
      runner: createJobRunner({
        clock: () => now,
        handlers: [handler],
        logFailure: (entry) => logs.push(entry),
        repository: fake.repository,
      }),
    };
  }

  const job = (overrides: Partial<ClaimedJob> = {}): ClaimedJob => ({
    attempts: 1,
    id: "job-1",
    payload: { giftId },
    type: "gift.assets.cleanup.v1",
    ...overrides,
  });

  it("claims only the registered types and completes a successful job", async () => {
    const { calls, runner: jobs } = runner([job()]);

    await expect(jobs.runStep()).resolves.toEqual({
      id: "job-1",
      outcome: "completed",
      type: "gift.assets.cleanup.v1",
    });
    expect(calls[0]).toEqual(["claimNext", ["gift.assets.cleanup.v1"]]);
    expect(run).toHaveBeenCalledWith({ giftId }, { jobId: "job-1", now });
    expect(calls).toContainEqual(["complete", "job-1"]);
  });

  it("reports idle when nothing is claimable", async () => {
    await expect(runner([]).runner.runStep()).resolves.toEqual({
      id: null,
      outcome: "idle",
      type: null,
    });
  });

  it("retries a retryable failure 60 seconds later (Retry with backoff)", async () => {
    run.mockRejectedValue(new JobFailure("STORAGE_DELETE_FAILED", true));
    const { calls, runner: jobs } = runner([job({ attempts: 1 })]);

    await expect(jobs.runStep()).resolves.toMatchObject({ outcome: "retrying" });
    expect(calls).toContainEqual([
      "retryLater",
      "job-1",
      "STORAGE_DELETE_FAILED",
      new Date(now.getTime() + 60_000),
    ]);
  });

  it("treats an unexpected error as retryable JOB_FAILED", async () => {
    run.mockRejectedValue(new Error("network"));
    const { calls, runner: jobs } = runner([job({ attempts: 2 })]);

    await jobs.runStep();
    expect(calls).toContainEqual([
      "retryLater",
      "job-1",
      "JOB_FAILED",
      new Date(now.getTime() + 120_000),
    ]);
  });

  it("caps the backoff at one hour", () => {
    expect(retryDelayMilliseconds(1)).toBe(60_000);
    expect(retryDelayMilliseconds(4)).toBe(480_000);
    expect(retryDelayMilliseconds(10)).toBe(3_600_000);
  });

  it("gives up after the budget (Budget used up)", async () => {
    run.mockRejectedValue(new Error("network"));
    const { calls, runner: jobs } = runner([job({ attempts: 5 })]);

    await expect(jobs.runStep()).resolves.toMatchObject({ outcome: "dead" });
    expect(calls).toContainEqual(["markDead", "job-1", "JOB_FAILED"]);
  });

  it("gives up at once on a permanent failure (Permanent failure)", async () => {
    run.mockRejectedValue(new JobFailure("GIFT_UNREADABLE", false));
    const { calls, runner: jobs } = runner([job({ attempts: 1 })]);

    await expect(jobs.runStep()).resolves.toMatchObject({ outcome: "dead" });
    expect(calls).toContainEqual(["markDead", "job-1", "GIFT_UNREADABLE"]);
  });

  it("runs a recovered lease again while it has attempts left (Crashed worker recovered)", async () => {
    const { runner: jobs } = runner([job({ attempts: 3 })]);

    await expect(jobs.runStep()).resolves.toMatchObject({ outcome: "completed" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("buries a recovered lease past its budget without running it", async () => {
    const { calls, runner: jobs } = runner([job({ attempts: 6 })]);

    await expect(jobs.runStep()).resolves.toMatchObject({ outcome: "dead" });
    expect(calls).toContainEqual(["markDead", "job-1", "LEASE_EXPIRED"]);
    expect(run).not.toHaveBeenCalled();
  });

  it("buries a malformed payload without running the handler (Malformed payload)", async () => {
    const { calls, runner: jobs } = runner([job({ payload: {} })]);

    await expect(jobs.runStep()).resolves.toMatchObject({ outcome: "dead" });
    expect(calls).toContainEqual(["markDead", "job-1", "INVALID_PAYLOAD"]);
    expect(run).not.toHaveBeenCalled();
  });

  it("logs only the id, type, attempts and code (Failure log holds no content)", async () => {
    run.mockRejectedValue(new Error(`secret ${giftId}`));
    await runner([job({ attempts: 2 })]).runner.runStep();

    expect(logs).toEqual([
      { attempts: 2, code: "JOB_FAILED", jobId: "job-1", type: "gift.assets.cleanup.v1" },
    ]);
    expect(JSON.stringify(logs)).not.toContain(giftId);
  });

  it("drains until idle or the limit", async () => {
    const { runner: jobs } = runner([job({ id: "a" }), job({ id: "b" }), job({ id: "c" })]);

    await expect(jobs.runAvailable(2)).resolves.toHaveLength(2);
    await expect(jobs.runAvailable(10)).resolves.toEqual([
      { id: "c", outcome: "completed", type: "gift.assets.cleanup.v1" },
    ]);
  });

  it("refuses a claimed type without a handler", async () => {
    const { runner: jobs } = runner([job({ type: "email.send.v1" })]);

    await expect(jobs.runStep()).rejects.toThrow("No handler for claimed job type email.send.v1.");
  });
});
