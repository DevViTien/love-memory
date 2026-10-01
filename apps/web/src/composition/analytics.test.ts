import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/modules/auth/infrastructure/auth-environment", () => ({
  getAuthEnvironment: () => ({ secret: "s".repeat(32) }),
}));

import {
  type AfterResponsePublishAnalyticsDependencies,
  createAfterResponsePublishAnalytics,
} from "./analytics";

const notice = {
  giftId: "gift-1",
  requestId: "request-1",
  templateId: "memory-box",
  templateVersion: "1.1.0",
};

function dependencies(
  overrides: Partial<AfterResponsePublishAnalyticsDependencies> = {},
): AfterResponsePublishAnalyticsDependencies {
  return {
    isEnabled: () => true,
    now: () => new Date("2026-10-01T08:00:00.000Z"),
    record: vi.fn(() => Promise.resolve(true)),
    report: vi.fn(),
    runAfter: vi.fn((task: () => Promise<void>) => void task()),
    ...overrides,
  };
}

describe("after-response publish analytics", () => {
  it("schedules the gift_published write after the response", async () => {
    const tasks: Array<() => Promise<void>> = [];
    const deps = dependencies({ runAfter: (task) => void tasks.push(task) });

    createAfterResponsePublishAnalytics(deps).giftPublished(notice);
    expect(deps.record).not.toHaveBeenCalled();

    await tasks[0]?.();
    expect(deps.record).toHaveBeenCalledWith(
      { id: "gift-1", templateId: "memory-box", templateVersion: "1.1.0" },
      new Date("2026-10-01T08:00:00.000Z"),
    );
  });

  it("reports a rejected write with the operation and request id and never throws", async () => {
    const tasks: Array<() => Promise<void>> = [];
    const error = new Error("database down");
    const deps = dependencies({
      record: vi.fn(() => Promise.reject(error)),
      runAfter: (task) => void tasks.push(task),
    });

    expect(() => createAfterResponsePublishAnalytics(deps).giftPublished(notice)).not.toThrow();
    await expect(tasks[0]?.()).resolves.toBeUndefined();
    expect(deps.report).toHaveBeenCalledWith("analytics_gift_published", error, "request-1");
  });

  it("writes nothing while analytics is disabled", () => {
    const deps = dependencies({ isEnabled: () => false });
    createAfterResponsePublishAnalytics(deps).giftPublished(notice);
    expect(deps.runAfter).not.toHaveBeenCalled();
    expect(deps.record).not.toHaveBeenCalled();
  });

  it("falls back to a detached write when after() has no request scope", async () => {
    const deps = dependencies({
      runAfter: () => {
        throw new Error("`after` was called outside a request scope.");
      },
    });

    expect(() => createAfterResponsePublishAnalytics(deps).giftPublished(notice)).not.toThrow();
    await vi.waitFor(() => expect(deps.record).toHaveBeenCalledTimes(1));
  });
});
