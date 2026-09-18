import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createIdempotencyKey: vi.fn(),
  runAvailable: vi.fn(),
  trigger: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  idempotencyKeys: { create: mocks.createIdempotencyKey },
  tasks: { trigger: mocks.trigger },
}));
vi.mock("@/composition/media", () => ({
  getMediaWorker: () => ({ runAvailable: mocks.runAvailable }),
}));

import {
  assertMediaRuntimeReady,
  mediaWorkerMode,
  scheduleMediaProcessing,
} from "./media-job-scheduler";

describe("media job scheduler", () => {
  beforeEach(() => vi.clearAllMocks());

  afterEach(() => vi.unstubAllEnvs());

  it("runs inline for local development", async () => {
    vi.stubEnv("MEDIA_WORKER_MODE", "inline");
    mocks.runAvailable.mockResolvedValue([]);
    await scheduleMediaProcessing("upload-complete");
    expect(mocks.runAvailable).toHaveBeenCalledOnce();
    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it("dispatches production work to Trigger.dev", async () => {
    vi.stubEnv("MEDIA_WORKER_MODE", "trigger");
    vi.stubEnv("TRIGGER_SECRET_KEY", "tr_dev_example");
    mocks.createIdempotencyKey.mockResolvedValue("hashed-key");
    mocks.trigger.mockResolvedValue({ id: "run-1" });
    await scheduleMediaProcessing("retry");
    expect(mocks.createIdempotencyKey).toHaveBeenCalledWith(
      expect.stringMatching(/^media-worker-drain:retry:\d+$/),
      { scope: "global" },
    );
    expect(mocks.trigger).toHaveBeenCalledWith(
      "media-worker-drain",
      { source: "retry" },
      { idempotencyKey: "hashed-key", idempotencyKeyTTL: "1m" },
    );
    expect(mocks.runAvailable).not.toHaveBeenCalled();
  });

  it("fails closed when durable production dispatch is not configured", async () => {
    vi.stubEnv("MEDIA_WORKER_MODE", "trigger");
    vi.stubEnv("TRIGGER_SECRET_KEY", "");
    await expect(scheduleMediaProcessing("retry")).rejects.toThrow("TRIGGER_SECRET_KEY");
    expect(() =>
      assertMediaRuntimeReady({ MEDIA_WORKER_MODE: "trigger", TRIGGER_SECRET_KEY: "" }),
    ).toThrow("TRIGGER_SECRET_KEY");
    expect(mediaWorkerMode({ NODE_ENV: "production" })).toBe("trigger");
    expect(() => mediaWorkerMode({ MEDIA_WORKER_MODE: "unknown" })).toThrow();
  });
});
