import {
  createLocalObjectStorage,
  createVercelBlobObjectStorage,
  getStorageConfiguration,
  getStorageEnvironment,
  type LocalObjectStorage,
  type ObjectStorage,
} from "@love-memory/storage";

import {
  createMediaSpikeService,
  type MediaSpikeService,
} from "@/modules/media/application/media-spike-service";
import { createMediaService, type MediaService } from "@/modules/media/application/media-service";
import { assertMediaOutboxFlowing } from "@/modules/media/application/media-outbox-health";
import { createMediaWorker, type MediaWorker } from "@/modules/media/application/media-worker";
import { mongoGiftRepository } from "@/modules/gifts/infrastructure/mongo-gift-repository";
import {
  mongoMediaAssetRepository,
  mongoMediaOutboxMonitor,
  mongoMediaWorkerRepository,
} from "@/modules/media/infrastructure/mongo-media-repository";
import { getGiftTemplateManifest } from "@/composition/gifts";
import { reportOperationalFailure } from "@/observability/operational-errors";

let mediaSpikeService: MediaSpikeService | undefined;
let mediaService: MediaService | undefined;
let mediaWorker: MediaWorker | undefined;

// Throws on a storage configuration error. Callers assign the result only after it succeeds, so a
// failed construction is never cached and a corrected environment recovers after a restart.
// Exported for the viewer payload, which signs derivative URLs with the same driver.
export function createStorage(): ObjectStorage {
  const configuration = getStorageConfiguration();
  return configuration.driver === "local"
    ? createLocalObjectStorage(configuration)
    : createVercelBlobObjectStorage({ credentials: getStorageEnvironment });
}

/** The local object store for the signed same-origin routes, or `null` unless local mode is active. */
export function getLocalObjectStorageRoute(): LocalObjectStorage | null {
  try {
    const configuration = getStorageConfiguration();
    return configuration.driver === "local" ? createLocalObjectStorage(configuration) : null;
  } catch {
    // A refused or misconfigured local driver keeps the routes inactive (404).
    return null;
  }
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

/** Readiness: throws `MediaOutboxStalledError` when a due media job has waited over 10 minutes. */
export function checkMediaOutbox(): Promise<void> {
  return assertMediaOutboxFlowing({ monitor: mongoMediaOutboxMonitor });
}
