import { type PlanOfferDto } from "@love-memory/contracts";
import { currentPlans, type Plan } from "@love-memory/domain";

import { type PlanGrantPolicy } from "./gift-service";

/**
 * The plans the Studio offers for a first publish (`gift-plans`), in catalog order: the current
 * version of each plan and whether this deployment can grant it. The page renders them into the
 * Studio, so the browser never holds a plan constant; the publish endpoint decides again.
 */
export function listPlanOffers(
  policy: PlanGrantPolicy,
  plans: readonly Plan[] = currentPlans(),
): PlanOfferDto[] {
  return plans.map((plan) => {
    const grant = policy.grantFor(plan.planId);
    return {
      available: grant.kind === "grant",
      internalGrant: grant.kind === "grant" && grant.source === "internal",
      maxPhotos: plan.maxPhotos,
      name: plan.name,
      planId: plan.planId,
      planVersion: plan.planVersion,
      priceVnd: plan.priceVnd,
      retentionDays: plan.retentionDays,
      watermark: plan.watermark,
    };
  });
}
