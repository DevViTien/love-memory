import { beforeEach, describe, expect, it, vi } from "vitest";

const triggerMocks = vi.hoisted(() => ({
  create: vi.fn((key: string) => Promise.resolve(`idem:${key}`)),
  trigger: vi.fn(() => Promise.resolve()),
}));

vi.mock("@trigger.dev/sdk", () => ({
  idempotencyKeys: { create: triggerMocks.create },
  tasks: { trigger: triggerMocks.trigger },
}));

import { createJobDispatcher, INLINE_JOB_STEPS, triggerJobsDrain } from "./job-dispatcher";

describe("job dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs up to 10 steps inline (Local inline run)", async () => {
    const runInline = vi.fn(() => Promise.resolve([]));
    const trigger = vi.fn(() => Promise.resolve());
    await createJobDispatcher({
      mode: () => "inline",
      reportFailure: () => undefined,
      runInline,
      trigger,
    }).dispatch("gift.assets.cleanup.v1");

    expect(runInline).toHaveBeenCalledWith(INLINE_JOB_STEPS);
    expect(INLINE_JOB_STEPS).toBe(10);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("asks Trigger.dev for a drain in trigger mode", async () => {
    const trigger = vi.fn(() => Promise.resolve());
    await createJobDispatcher({
      mode: () => "trigger",
      reportFailure: () => undefined,
      runInline: () => Promise.resolve(),
      trigger,
    }).dispatch("gift.assets.cleanup.v1");

    expect(trigger).toHaveBeenCalledWith("gift.assets.cleanup.v1");
  });

  it("reports and swallows any failure (Job failure does not fail the request)", async () => {
    const reportFailure = vi.fn();
    const failure = new Error("job failed");
    const dispatcher = createJobDispatcher({
      mode: () => "inline",
      reportFailure,
      runInline: () => Promise.reject(failure),
      trigger: () => Promise.resolve(),
    });

    await expect(dispatcher.dispatch("gift.assets.cleanup.v1")).resolves.toBeUndefined();
    expect(reportFailure).toHaveBeenCalledWith(failure);

    const misconfigured = createJobDispatcher({
      mode: () => {
        throw new Error("MEDIA_WORKER_MODE must be either inline or trigger.");
      },
      reportFailure,
      runInline: () => Promise.resolve(),
      trigger: () => Promise.resolve(),
    });
    await expect(misconfigured.dispatch("gift.assets.cleanup.v1")).resolves.toBeUndefined();
    expect(reportFailure).toHaveBeenCalledTimes(2);
  });

  it("dedupes drains per type and 10-second window", async () => {
    await triggerJobsDrain("gift.assets.cleanup.v1", new Date(1_000_005_000));

    expect(triggerMocks.create).toHaveBeenCalledWith("jobs-drain:gift.assets.cleanup.v1:100000", {
      scope: "global",
    });
    expect(triggerMocks.trigger).toHaveBeenCalledWith(
      "jobs-drain",
      {},
      { idempotencyKey: "idem:jobs-drain:gift.assets.cleanup.v1:100000", idempotencyKeyTTL: "1m" },
    );
  });
});
