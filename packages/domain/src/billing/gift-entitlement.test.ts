import { describe, expect, it } from "vitest";

import {
  entitlementExpiry,
  exceedsPhotoLimit,
  GiftEntitlementSchema,
  grantEntitlement,
} from "./gift-entitlement";
import { currentPlan } from "./plan";

const now = new Date("2026-10-08T10:00:00.000Z");

describe("gift entitlement", () => {
  it("grants the Free plan for 14 days", () => {
    const grant = grantEntitlement(currentPlan("free"), "free", now);

    expect(grant.entitlement).toEqual({
      grantedAt: now,
      maxPhotos: 3,
      passwordAccess: false,
      planId: "free",
      planVersion: 1,
      priceVnd: 0,
      retentionDays: 14,
      scheduledAccess: false,
      source: "free",
      watermark: true,
    });
    expect(grant.expiresAt).toEqual(new Date("2026-10-22T10:00:00.000Z"));
  });

  it("grants the Standard plan for 365 days with every capability", () => {
    const grant = grantEntitlement(currentPlan("standard"), "internal", now);

    expect(grant.entitlement).toMatchObject({
      maxPhotos: null,
      passwordAccess: true,
      planId: "standard",
      priceVnd: 49_000,
      scheduledAccess: true,
      source: "internal",
      watermark: false,
    });
    expect(grant.expiresAt).toEqual(new Date("2027-10-08T10:00:00.000Z"));
    expect(entitlementExpiry(grant.entitlement)).toEqual(grant.expiresAt);
  });

  it("rejects an unknown source or extra keys", () => {
    const { entitlement } = grantEntitlement(currentPlan("free"), "free", now);

    expect(GiftEntitlementSchema.safeParse({ ...entitlement, source: "order" }).success).toBe(
      false,
    );
    expect(GiftEntitlementSchema.safeParse({ ...entitlement, orderId: "x" }).success).toBe(false);
  });

  it("limits photos only when the plan has a maximum", () => {
    expect(exceedsPhotoLimit({ maxPhotos: 3 }, 3)).toBe(false);
    expect(exceedsPhotoLimit({ maxPhotos: 3 }, 4)).toBe(true);
    expect(exceedsPhotoLimit({ maxPhotos: null }, 30)).toBe(false);
  });
});
