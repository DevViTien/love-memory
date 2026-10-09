import { randomBytes, randomUUID } from "node:crypto";

import { analyticsContextForGift, publishAnalytics } from "@/composition/analytics";
import { audioCatalog } from "@/composition/audio";
import { resolveTemplateArtifact } from "@/composition/templates";
import { getBillingEnvironment } from "@/config/billing";
import {
  findPaidOrderForGift,
  findPaidOrderForOwnerGift,
} from "@/modules/billing/infrastructure/mongo-order-repository";
import { createGiftLifecycleService } from "@/modules/gifts/application/gift-lifecycle";
import { listPlanOffers } from "@/modules/gifts/application/plan-offers";
import { createGiftService, type PlanGrantPolicy } from "@/modules/gifts/application/gift-service";
import { getAuthEnvironment } from "@/modules/auth/infrastructure/auth-environment";
import { createIdempotentAnonymousDraftIdentity } from "@/modules/gifts/infrastructure/anonymous-draft-identity";
import { mongoGiftLifecycleRepository } from "@/modules/gifts/infrastructure/mongo-gift-lifecycle-repository";
import { mongoGiftRepository } from "@/modules/gifts/infrastructure/mongo-gift-repository";
import { type GiftLifecycleRouteDependencies } from "@/modules/gifts/presentation/gift-lifecycle-route-handler";
import {
  enforceGiftMutationRateLimit,
  getGiftRequestContext,
} from "@/modules/gifts/presentation/gift-route-helpers";
import { mongoGiftTemplateRepository } from "@/modules/gifts/infrastructure/mongo-gift-template-repository";
import { mongoMediaAssetRepository } from "@/modules/media/infrastructure/mongo-media-repository";

/**
 * `gift-plans` "Plan availability": Free always; Standard through checkout while a billing provider
 * is configured, otherwise not at all. Read per request, so a corrected environment applies
 * without a rebuild.
 */
export const planGrantPolicy: PlanGrantPolicy = {
  grantFor: (planId) => {
    if (planId === "free") return { kind: "grant", source: "free" };
    return getBillingEnvironment().kind !== "off" ? { kind: "checkout" } : { kind: "unavailable" };
  },
};

export const giftService = createGiftService({
  // Funnel analytics: the page context after the owner filter, and `gift_published` after the
  // response. Both read the configuration per call and do nothing while analytics is disabled.
  analytics: { contextForGift: analyticsContextForGift, publish: publishAnalytics },
  audioTracks: audioCatalog,
  clock: () => new Date(),
  createAnonymousIdentity: (idempotencyKey) =>
    createIdempotentAnonymousDraftIdentity(idempotencyKey, getAuthEnvironment().secret),
  createId: randomUUID,
  createPublicId: () => randomBytes(18).toString("base64url"),
  gifts: mongoGiftRepository,
  // Loaded on use: `composition/jobs` builds on media and gifts, so a static import would cycle.
  jobs: {
    dispatch: async (type) => (await import("@/composition/jobs")).jobDispatcher.dispatch(type),
  },
  publishing: {
    artifacts: {
      resolve: async (templateId, version) => {
        const artifact = await resolveTemplateArtifact(templateId, version);
        return artifact ? { contentHash: artifact.contentHash } : null;
      },
    },
    assets: mongoMediaAssetRepository,
    paidOrders: {
      findPaidForGift: async (giftId) => {
        const order = await findPaidOrderForGift(giftId);
        return order
          ? { orderId: order.id, planId: order.planId, planVersion: order.planVersion }
          : null;
      },
    },
    // 16 bytes from the CSPRNG: 22 unpadded base64url characters, derived from nothing else.
    createShareId: () => randomBytes(16).toString("base64url"),
    plans: planGrantPolicy,
  },
  templates: mongoGiftTemplateRepository,
});

export function getGiftTemplateManifest(templateId: string, version: string) {
  return mongoGiftTemplateRepository.findEditableManifest(templateId, version);
}

/** Owner pause, resume and delete (`gift-lifecycle`). */
export const giftLifecycleService = createGiftLifecycleService({
  gifts: mongoGiftLifecycleRepository,
  // Loaded on use, like the gift service's dispatcher: `composition/jobs` builds on this module.
  jobs: {
    dispatch: async (type) => (await import("@/composition/jobs")).jobDispatcher.dispatch(type),
  },
});

export const giftLifecycleRouteDependencies: GiftLifecycleRouteDependencies = {
  getAccessors: async (request) => (await getGiftRequestContext(request)).accessors,
  limit: async (request, id) =>
    enforceGiftMutationRateLimit(
      request,
      await getGiftRequestContext(request),
      "gift-lifecycle",
      id,
    ),
  service: giftLifecycleService,
};

/** The Studio's plan offers for a gift, with the plan its owner's paid order already covers. */
export async function getStudioPlanOffers(publicId: string, userId: string | null) {
  const paid = userId ? await findPaidOrderForOwnerGift(publicId, userId) : null;
  return listPlanOffers(
    planGrantPolicy,
    undefined,
    paid ? { orderId: paid.id, planId: paid.planId, planVersion: paid.planVersion } : null,
  );
}
