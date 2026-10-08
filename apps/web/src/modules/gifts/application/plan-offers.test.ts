import { PlanOfferDtoSchema } from "@love-memory/contracts";
import { describe, expect, it } from "vitest";

import { type PlanGrant } from "./gift-service";
import { listPlanOffers } from "./plan-offers";

const grants = (standard: PlanGrant) => ({
  grantFor: (planId: "free" | "standard"): PlanGrant =>
    planId === "free" ? { kind: "grant", source: "free" } : standard,
});

describe("plan offers", () => {
  it("offers Free and an unavailable Standard without the internal grant (Plans offered)", () => {
    const offers = listPlanOffers(grants({ kind: "unavailable" }));

    expect(offers).toEqual([
      {
        available: true,
        internalGrant: false,
        maxPhotos: 3,
        name: "Miễn phí",
        planId: "free",
        planVersion: 1,
        priceVnd: 0,
        retentionDays: 14,
        watermark: true,
      },
      {
        available: false,
        internalGrant: false,
        maxPhotos: null,
        name: "Tiêu chuẩn",
        planId: "standard",
        planVersion: 1,
        priceVnd: 49_000,
        retentionDays: 365,
        watermark: false,
      },
    ]);
    for (const offer of offers) expect(PlanOfferDtoSchema.parse(offer)).toEqual(offer);
  });

  it("marks Standard as available through the internal grant", () => {
    const [, standard] = listPlanOffers(grants({ kind: "grant", source: "internal" }));

    expect(standard).toMatchObject({ available: true, internalGrant: true, planId: "standard" });
  });
});
