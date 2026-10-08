import { z } from "zod";

export const PLAN_IDS = ["free", "standard"] as const;

export const PlanIdSchema = z.enum(PLAN_IDS);

export type PlanId = z.infer<typeof PlanIdSchema>;

/** One released version of a plan. A released version never changes (ADR-0011). */
export const PlanSchema = z
  .object({
    /** `null`: only the template's own limits apply. */
    maxPhotos: z.number().int().positive().nullable(),
    name: z.string().min(1),
    passwordAccess: z.boolean(),
    planId: PlanIdSchema,
    planVersion: z.number().int().positive(),
    /** An integer amount in Vietnamese đồng. */
    priceVnd: z.number().int().nonnegative(),
    retentionDays: z.number().int().positive(),
    scheduledAccess: z.boolean(),
    watermark: z.boolean(),
  })
  .strict();

export type Plan = z.infer<typeof PlanSchema>;

/**
 * Every released plan version. A new price, limit or capability is appended as a new version;
 * granted entitlements keep the snapshot of the version they were granted from.
 */
export const PLAN_CATALOG: readonly Plan[] = Object.freeze(
  [
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
  ].map((plan) => Object.freeze(PlanSchema.parse(plan))),
);

/** The version of a plan offered for new publishes: its highest released version. */
export function currentPlan(planId: PlanId, catalog: readonly Plan[] = PLAN_CATALOG): Plan {
  let current: Plan | undefined;
  for (const plan of catalog) {
    if (plan.planId === planId && (!current || plan.planVersion > current.planVersion)) {
      current = plan;
    }
  }
  if (!current) throw new Error(`No released version of plan ${planId}.`);
  return current;
}

/** The current version of every plan, in catalog order. */
export function currentPlans(catalog: readonly Plan[] = PLAN_CATALOG): readonly Plan[] {
  return PLAN_IDS.map((planId) => currentPlan(planId, catalog));
}
