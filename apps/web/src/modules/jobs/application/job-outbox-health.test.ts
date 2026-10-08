import { describe, expect, it, vi } from "vitest";

import { assertJobOutboxFlowing, JobOutboxStalledError } from "./job-outbox-health";

const now = new Date("2026-10-08T10:00:00.000Z");
const types = ["gift.assets.cleanup.v1"] as const;

describe("job outbox health", () => {
  it("fails for a job due more than 10 minutes ago (Generic job worker stalled)", async () => {
    const hasOverdueJob = vi.fn(() => Promise.resolve(true));

    await expect(
      assertJobOutboxFlowing({ monitor: { hasOverdueJob }, now, types }),
    ).rejects.toBeInstanceOf(JobOutboxStalledError);
    expect(hasOverdueJob).toHaveBeenCalledWith(types, new Date("2026-10-08T09:50:00.000Z"));
  });

  it("passes when no job is overdue, such as a retry due later (Generic retry is not a stall)", async () => {
    await expect(
      assertJobOutboxFlowing({
        monitor: { hasOverdueJob: () => Promise.resolve(false) },
        now,
        types,
      }),
    ).resolves.toBeUndefined();
  });

  it("names the error for the readiness log", () => {
    expect(new JobOutboxStalledError().name).toBe("JobOutboxStalledError");
  });
});
