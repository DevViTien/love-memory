import "server-only";

export type InternalPlanGrantEnvironment = Readonly<{ enabled: boolean }>;

/**
 * The internal paid-plan grant (`gift-plans`): the Standard plan without payment, until checkout
 * exists. It is on only when `INTERNAL_PLAN_GRANT_ENABLED` is exactly `true` and the deployment is
 * not Vercel Production. Any other value, including a typo, reads as off and never throws: the flag
 * is read per request, so a bad value must not take the site down.
 */
export function parseInternalPlanGrantEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): InternalPlanGrantEnvironment {
  return {
    enabled:
      source["INTERNAL_PLAN_GRANT_ENABLED"] === "true" && source["VERCEL_ENV"] !== "production",
  };
}

export function getInternalPlanGrantEnvironment(): InternalPlanGrantEnvironment {
  return parseInternalPlanGrantEnvironment(process.env);
}
