import { describe, expect, it } from "vitest";

import { getHealthStatus } from "./get-health-status";

describe("getHealthStatus", () => {
  it("returns a deterministic healthy response", () => {
    const status = getHealthStatus({
      clock: () => new Date("2026-09-15T10:00:00.000Z"),
      version: "0.1.0",
    });

    expect(status).toEqual({
      service: "love-memory",
      status: "ok",
      timestamp: "2026-09-15T10:00:00.000Z",
      version: "0.1.0",
    });
  });

  it("uses the system clock when one is not injected", () => {
    const status = getHealthStatus({ version: "0.1.0" });

    expect(Number.isNaN(Date.parse(status.timestamp))).toBe(false);
  });
});
