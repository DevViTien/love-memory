import { describe, expect, it } from "vitest";

import { currentPlan, currentPlans, PLAN_CATALOG, PlanIdSchema, type Plan } from "./plan";

describe("plan catalog", () => {
  it("pins the released Free and Standard versions", () => {
    expect(PLAN_CATALOG).toEqual([
      {
        maxPhotos: 3,
        name: "Miễn phí",
        passwordAccess: false,
        planId: "free",
        planVersion: 1,
        priceVnd: 0,
        retentionDays: 14,
        scheduledAccess: false,
        watermark: true,
      },
      {
        maxPhotos: null,
        name: "Tiêu chuẩn",
        passwordAccess: true,
        planId: "standard",
        planVersion: 1,
        priceVnd: 49_000,
        retentionDays: 365,
        scheduledAccess: true,
        watermark: false,
      },
    ]);
  });

  it("cannot be changed at runtime", () => {
    expect(Object.isFrozen(PLAN_CATALOG)).toBe(true);
    expect(Object.isFrozen(PLAN_CATALOG[0])).toBe(true);
  });

  it("offers the highest released version of each plan", () => {
    const free2: Plan = { ...currentPlan("free"), maxPhotos: 5, planVersion: 2 };
    const catalog = [free2, ...PLAN_CATALOG];

    expect(currentPlan("free", catalog)).toBe(free2);
    expect(currentPlan("standard", catalog).planVersion).toBe(1);
    expect(currentPlans(catalog).map((plan) => [plan.planId, plan.planVersion])).toEqual([
      ["free", 2],
      ["standard", 1],
    ]);
  });

  it("fails loudly for a plan without a released version", () => {
    expect(() => currentPlan("standard", [currentPlan("free")])).toThrow(
      "No released version of plan standard.",
    );
  });

  it("knows only the released plan ids", () => {
    expect(PlanIdSchema.safeParse("premium").success).toBe(false);
    expect(PlanIdSchema.safeParse("free").success).toBe(true);
  });
});
