import { createStorage } from "@/composition/media";
import { createGiftExportService } from "@/modules/gifts/application/gift-export";
import { mongoGiftRepository } from "@/modules/gifts/infrastructure/mongo-gift-repository";
import { type GiftExportRouteDependencies } from "@/modules/gifts/presentation/gift-export-route-handler";
import {
  enforceGiftMutationRateLimit,
  getGiftRequestContext,
} from "@/modules/gifts/presentation/gift-route-helpers";
import { mongoMediaAssetRepository } from "@/modules/media/infrastructure/mongo-media-repository";

export const giftExportService = createGiftExportService({
  assets: mongoMediaAssetRepository,
  gifts: mongoGiftRepository,
  // Built per export: a storage configuration error fails that request and is never cached.
  signDownloadUrl: (key, expiresInSeconds) =>
    createStorage().createDownloadUrl(key, expiresInSeconds),
});

export const giftExportRouteDependencies: GiftExportRouteDependencies = {
  getAccessors: async (request) => (await getGiftRequestContext(request)).accessors,
  // Owner-only reads share the `gift-read` budget.
  limit: async (request, id) =>
    enforceGiftMutationRateLimit(request, await getGiftRequestContext(request), "gift-read", id),
  service: giftExportService,
};
