import { describe, expect, it, vi } from "vitest";

import {
  assertMediaOutboxFlowing,
  MEDIA_OUTBOX_STALL_THRESHOLD_MILLISECONDS,
  MediaOutboxStalledError,
  type MediaOutboxMonitor,
} from "./media-outbox-health";

const now = new Date("2026-10-01T07:00:00.000Z");

function monitor(overdue: boolean): MediaOutboxMonitor {
  return { hasOverdueJob: vi.fn(() => Promise.resolve(overdue)) };
}

describe("media outbox health", () => {
  it("asks for jobs due at least ten minutes before now", async () => {
    const flowing = monitor(false);

    await expect(assertMediaOutboxFlowing({ monitor: flowing, now })).resolves.toBeUndefined();
    expect(MEDIA_OUTBOX_STALL_THRESHOLD_MILLISECONDS).toBe(600_000);
    expect(flowing.hasOverdueJob).toHaveBeenCalledWith(new Date("2026-10-01T06:50:00.000Z"));
  });

  it("throws a named error when a job is overdue (Media worker stalled)", async () => {
    const error = await assertMediaOutboxFlowing({ monitor: monitor(true), now }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(MediaOutboxStalledError);
    expect((error as Error).name).toBe("MediaOutboxStalledError");
  });

  it("defaults to the current time", async () => {
    const flowing = monitor(false);
    await assertMediaOutboxFlowing({ monitor: flowing });
    expect(flowing.hasOverdueJob).toHaveBeenCalledOnce();
  });
});
