import { mongoGiftRepository } from "@/modules/gifts/infrastructure/mongo-gift-repository";
import { mongoGiftTemplateRepository } from "@/modules/gifts/infrastructure/mongo-gift-template-repository";
import { mongoMediaAssetRepository } from "@/modules/media/infrastructure/mongo-media-repository";
import {
  createPreviewService,
  type PreviewService,
} from "@/modules/preview/application/preview-service";
import { mongoPreviewTokenRepository } from "@/modules/preview/infrastructure/mongo-preview-token-repository";
import { viewerPayloadDependencies } from "@/composition/viewer";

let previewService: PreviewService | undefined;

export function getPreviewService(): PreviewService {
  previewService ??= createPreviewService({
    assets: mongoMediaAssetRepository,
    clock: () => new Date(),
    gifts: mongoGiftRepository,
    payload: viewerPayloadDependencies,
    templates: mongoGiftTemplateRepository,
    tokens: mongoPreviewTokenRepository,
  });
  return previewService;
}
