import { describe, expect, it } from "vitest";

import { HealthResponseSchema } from "./health";

describe("health API contract", () => {
  it("accepts the documented response envelope", () => {
    expect(
      HealthResponseSchema.parse({
        data: {
          service: "love-memory",
          status: "ok",
          timestamp: "2026-09-15T10:00:00.000Z",
          version: "0.1.0",
        },
      }),
    ).toMatchObject({ data: { status: "ok" } });
  });

  it("rejects a non-ISO timestamp", () => {
    expect(
      HealthResponseSchema.safeParse({
        data: { service: "love-memory", status: "ok", timestamp: "today", version: "0.1.0" },
      }).success,
    ).toBe(false);
  });
});
