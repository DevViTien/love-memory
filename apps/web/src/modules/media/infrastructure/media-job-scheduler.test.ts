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
    await scheduleMediaProcessing("upload-complete", "asset-1");
    expect(mocks.runAvailable).toHaveBeenCalledOnce();
    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it("dispatches production work to Trigger.dev", async () => {
    vi.stubEnv("MEDIA_WORKER_MODE", "trigger");
    vi.stubEnv("TRIGGER_SECRET_KEY", "tr_dev_example");
    mocks.createIdempotencyKey.mockResolvedValue("hashed-key");
    mocks.trigger.mockResolvedValue({ id: "run-1" });
    await scheduleMediaProcessing("retry", "asset-1");
    await scheduleMediaProcessing("retry", "asset-2");
    expect(mocks.createIdempotencyKey).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^media-worker-drain:retry:asset-1:\d+$/),
      { scope: "global" },
    );
    expect(mocks.createIdempotencyKey).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^media-worker-drain:retry:asset-2:\d+$/),
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
    await expect(scheduleMediaProcessing("retry", "asset-1")).rejects.toThrow("TRIGGER_SECRET_KEY");
    expect(() =>
      assertMediaRuntimeReady({ MEDIA_WORKER_MODE: "trigger", TRIGGER_SECRET_KEY: "" }),
    ).toThrow("TRIGGER_SECRET_KEY");
    expect(mediaWorkerMode({ NODE_ENV: "production" })).toBe("trigger");
    expect(() => mediaWorkerMode({ MEDIA_WORKER_MODE: "unknown" })).toThrow();
  });

  it("refuses the local storage driver with Trigger.dev workers", () => {
    const trigger = { MEDIA_WORKER_MODE: "trigger", TRIGGER_SECRET_KEY: "tr_dev_example" };
    expect(() => assertMediaRuntimeReady(trigger, "local")).toThrow("MEDIA_WORKER_MODE=inline");
    expect(() =>
      assertMediaRuntimeReady({ NODE_ENV: "production", TRIGGER_SECRET_KEY: "tr" }, "local"),
    ).toThrow("MEDIA_WORKER_MODE=inline");
    expect(assertMediaRuntimeReady(trigger, "vercel-blob")).toBe("trigger");
    expect(assertMediaRuntimeReady({ MEDIA_WORKER_MODE: "inline" }, "local")).toBe("inline");
  });
});
