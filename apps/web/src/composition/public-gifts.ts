import { analyticsContextForGift } from "@/composition/analytics";
import { viewerPayloadDependencies } from "@/composition/viewer";
import { getAuthEnvironment } from "@/modules/auth/infrastructure/auth-environment";
import { consumeApiRateLimit } from "@/modules/gifts/infrastructure/mongo-gift-rate-limiter";
import { mongoGiftPublicationRepository } from "@/modules/gifts/infrastructure/mongo-gift-publication-repository";
import { mongoGiftRepository } from "@/modules/gifts/infrastructure/mongo-gift-repository";
import { mongoGiftTemplateRepository } from "@/modules/gifts/infrastructure/mongo-gift-template-repository";
import { mongoMediaAssetRepository } from "@/modules/media/infrastructure/mongo-media-repository";
import {
  createPublicGiftService,
  type PublicGiftService,
} from "@/modules/public-gifts/application/public-gift-service";
import { type PublicReadRateLimitScope } from "@/modules/public-gifts/presentation/public-gift-route-handler";

let publicGiftService: PublicGiftService | undefined;

/** The recipient side of a published gift; signs asset URLs only after the liveness check. */
export function getPublicGiftService(): PublicGiftService {
  publicGiftService ??= createPublicGiftService({
    analytics: { contextForGift: analyticsContextForGift },
    assets: mongoMediaAssetRepository,
    gifts: mongoGiftRepository,
    payload: viewerPayloadDependencies,
    publications: mongoGiftPublicationRepository,
    templates: mongoGiftTemplateRepository,
  });
  return publicGiftService;
}

/** The public read counters share the mutation limits' storage and keyed subject hashing. */
export function consumePublicReadRateLimit(
  scope: PublicReadRateLimitScope,
  subject: string,
): ReturnType<typeof consumeApiRateLimit> {
  return consumeApiRateLimit(scope, subject, getAuthEnvironment().secret);
}
