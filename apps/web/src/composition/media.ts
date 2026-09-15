import { createVercelBlobObjectStorage, getStorageEnvironment } from "@love-memory/storage";

import {
  createMediaSpikeService,
  type MediaSpikeService,
} from "@/modules/media/application/media-spike-service";

let mediaSpikeService: MediaSpikeService | undefined;

export function getMediaSpikeService(): MediaSpikeService {
  if (!mediaSpikeService) {
    mediaSpikeService = createMediaSpikeService({
      storage: createVercelBlobObjectStorage({ credentials: getStorageEnvironment }),
    });
  }

  return mediaSpikeService;
}
