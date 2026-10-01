import "server-only";

export type InternalPublishEnvironment = Readonly<{ enabled: boolean }>;

/**
 * The internal free publish entitlement of Sprint 3. It is on only when `INTERNAL_PUBLISH_ENABLED`
 * is exactly `true` and the deployment is not Vercel Production. Any other value, including a typo,
 * reads as off and never throws: the flag is read per request, so a bad value must not take the
 * site down. Sprint 4 replaces it with a real entitlement (ADR-0009).
 */
export function parseInternalPublishEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): InternalPublishEnvironment {
  return {
    enabled: source["INTERNAL_PUBLISH_ENABLED"] === "true" && source["VERCEL_ENV"] !== "production",
  };
}

export function getInternalPublishEnvironment(): InternalPublishEnvironment {
  return parseInternalPublishEnvironment(process.env);
}
