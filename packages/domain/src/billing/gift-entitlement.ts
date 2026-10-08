import { z } from "zod";

import { PlanIdSchema, type Plan } from "./plan";

export const DAY_MILLISECONDS = 86_400_000;

export const ENTITLEMENT_SOURCES = ["free", "internal", "legacy"] as const;

/** How an entitlement was granted; a payment adds `order` with the checkout change. */
export const EntitlementSourceSchema = z.enum(ENTITLEMENT_SOURCES);

export type EntitlementSource = z.infer<typeof EntitlementSourceSchema>;

/**
 * The plan values a gift was granted at its first publish. It is a snapshot: every check of a
 * published gift reads it, never the current catalog.
 */
export const GiftEntitlementSchema = z
  .object({
    grantedAt: z.coerce.date(),
    maxPhotos: z.number().int().positive().nullable(),
    passwordAccess: z.boolean(),
    planId: PlanIdSchema,
    planVersion: z.number().int().positive(),
    priceVnd: z.number().int().nonnegative(),
    retentionDays: z.number().int().positive(),
    scheduledAccess: z.boolean(),
    source: EntitlementSourceSchema,
    watermark: z.boolean(),
  })
  .strict();

export type GiftEntitlement = z.infer<typeof GiftEntitlementSchema>;

export type EntitlementGrant = Readonly<{ entitlement: GiftEntitlement; expiresAt: Date }>;

/** The end of a gift's share link: `grantedAt` plus `retentionDays` whole days. */
export function entitlementExpiry(
  entitlement: Pick<GiftEntitlement, "grantedAt" | "retentionDays">,
) {
  return new Date(entitlement.grantedAt.getTime() + entitlement.retentionDays * DAY_MILLISECONDS);
}

export function grantEntitlement(
  plan: Plan,
  source: EntitlementSource,
  now: Date,
): EntitlementGrant {
  const entitlement = GiftEntitlementSchema.parse({
    grantedAt: now,
    maxPhotos: plan.maxPhotos,
    passwordAccess: plan.passwordAccess,
    planId: plan.planId,
    planVersion: plan.planVersion,
    priceVnd: plan.priceVnd,
    retentionDays: plan.retentionDays,
    scheduledAccess: plan.scheduledAccess,
    source,
    watermark: plan.watermark,
  });
  return { entitlement, expiresAt: entitlementExpiry(entitlement) };
}

/** Whether a photo count fits a plan or an entitlement; `null` never limits. */
export function exceedsPhotoLimit(
  limit: Readonly<{ maxPhotos: number | null }>,
  photoCount: number,
): boolean {
  return limit.maxPhotos !== null && photoCount > limit.maxPhotos;
}
