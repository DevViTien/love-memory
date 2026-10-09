import { type PlanOfferDto } from "@love-memory/contracts";
import { currentPlans, type Plan, planVersionOf } from "@love-memory/domain";

import { type PaidOrder, type PlanGrantPolicy } from "./gift-service";

/**
 * The plans the Studio offers for a first publish (`gift-plans`), in catalog order: the current
 * version of each plan and whether this deployment can grant it, or the version a paid order of the
 * gift already bought. The page renders them into the Studio, so the browser never holds a plan
 * constant; the publish endpoint decides again.
 */
export function listPlanOffers(
  policy: PlanGrantPolicy,
  plans: readonly Plan[] = currentPlans(),
  paid: PaidOrder | null = null,
): PlanOfferDto[] {
  return plans.map((current) => {
    const prepaid = paid?.planId === current.planId;
    const plan = prepaid ? planVersionOf(paid.planId, paid.planVersion) : current;
    const grant = policy.grantFor(plan.planId);
    return {
      available: prepaid || grant.kind !== "unavailable",
      checkout: !prepaid && grant.kind === "checkout",
      maxPhotos: plan.maxPhotos,
      name: plan.name,
      planId: plan.planId,
      planVersion: plan.planVersion,
      prepaid,
      priceVnd: plan.priceVnd,
      retentionDays: plan.retentionDays,
      watermark: plan.watermark,
    };
  });
}
