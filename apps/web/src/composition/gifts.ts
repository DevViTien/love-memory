import { randomBytes, randomUUID } from "node:crypto";

import { analyticsContextForGift, publishAnalytics } from "@/composition/analytics";
import { audioCatalog } from "@/composition/audio";
import { getInternalPlanGrantEnvironment } from "@/config/internal-plan-grant";
import { createGiftService, type PlanGrantPolicy } from "@/modules/gifts/application/gift-service";
import { getAuthEnvironment } from "@/modules/auth/infrastructure/auth-environment";
import { createIdempotentAnonymousDraftIdentity } from "@/modules/gifts/infrastructure/anonymous-draft-identity";
import { mongoGiftRepository } from "@/modules/gifts/infrastructure/mongo-gift-repository";
import { mongoGiftTemplateRepository } from "@/modules/gifts/infrastructure/mongo-gift-template-repository";
import { mongoMediaAssetRepository } from "@/modules/media/infrastructure/mongo-media-repository";
import { getTemplateArtifact } from "@/modules/templates/infrastructure/template-artifact-registry";

/**
 * `gift-plans` "Plan availability": Free always; Standard only through the internal paid-plan grant
 * until checkout exists. Read per request, so a corrected environment applies without a rebuild.
 */
export const planGrantPolicy: PlanGrantPolicy = {
  grantFor: (planId) => {
    if (planId === "free") return { kind: "grant", source: "free" };
    return getInternalPlanGrantEnvironment().enabled
      ? { kind: "grant", source: "internal" }
      : { kind: "unavailable" };
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
      resolve: (templateId, version) => {
        const artifact = getTemplateArtifact(templateId, version);
        return artifact ? { contentHash: artifact.contentHash } : null;
      },
    },
    assets: mongoMediaAssetRepository,
    // 16 bytes from the CSPRNG: 22 unpadded base64url characters, derived from nothing else.
    createShareId: () => randomBytes(16).toString("base64url"),
    plans: planGrantPolicy,
  },
  templates: mongoGiftTemplateRepository,
});

export function getGiftTemplateManifest(templateId: string, version: string) {
  return mongoGiftTemplateRepository.findEditableManifest(templateId, version);
}
