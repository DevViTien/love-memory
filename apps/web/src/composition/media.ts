import { createVercelBlobObjectStorage, getStorageEnvironment } from "@love-memory/storage";

import {
  createMediaSpikeService,
  type MediaSpikeService,
} from "@/modules/media/application/media-spike-service";
import { createMediaService, type MediaService } from "@/modules/media/application/media-service";
import { createMediaWorker, type MediaWorker } from "@/modules/media/application/media-worker";
import { mongoGiftRepository } from "@/modules/gifts/infrastructure/mongo-gift-repository";
import {
  mongoMediaAssetRepository,
  mongoMediaWorkerRepository,
} from "@/modules/media/infrastructure/mongo-media-repository";
import { getGiftTemplateManifest } from "@/composition/gifts";
import { reportOperationalFailure } from "@/observability/operational-errors";

let mediaSpikeService: MediaSpikeService | undefined;
let mediaService: MediaService | undefined;
let mediaWorker: MediaWorker | undefined;

function createStorage() {
  return createVercelBlobObjectStorage({ credentials: getStorageEnvironment });
}

export function getMediaSpikeService(): MediaSpikeService {
  if (!mediaSpikeService) {
    mediaSpikeService = createMediaSpikeService({ storage: createStorage() });
  }

  return mediaSpikeService;
}

export function getMediaService(): MediaService {
  if (!mediaService) {
    mediaService = createMediaService({
      assets: mongoMediaAssetRepository,
      authorizeGift: (publicId, accessors) =>
        mongoGiftRepository.findAuthorized(publicId, accessors),
      findManifest: getGiftTemplateManifest,
      storage: createStorage(),
    });
  }
  return mediaService;
}

export function getMediaWorker(): MediaWorker {
  if (!mediaWorker) {
    mediaWorker = createMediaWorker({
      reportCleanupFailure: (error, assetId) =>
        reportOperationalFailure("media.source-cleanup", error, assetId),
      reportProcessingFailure: (error, assetId) =>
        reportOperationalFailure("media.processing", error, assetId),
      repository: mongoMediaWorkerRepository,
      storage: createStorage(),
    });
  }
  return mediaWorker;
}
