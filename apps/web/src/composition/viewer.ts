import { type ObjectStorage, STORAGE_LIMITS } from "@love-memory/storage";

import { audioCatalog } from "@/composition/audio";
import { createStorage } from "@/composition/media";
import { type BuildViewerPayloadDependencies } from "@/modules/viewer/application/build-viewer-payload";
import { resolveTemplateArtifact } from "@/composition/templates";

let storage: ObjectStorage | undefined;

function getStorage(): ObjectStorage {
  // Assigned only after construction succeeds, like the media composition.
  storage ??= createStorage();
  return storage;
}

/** The ports of `buildViewerPayload`, shared by preview and the published Viewer. */
export const viewerPayloadDependencies: BuildViewerPayloadDependencies = {
  clock: () => new Date(),
  downloadUrlTtlSeconds: STORAGE_LIMITS.downloadUrlTtlSeconds,
  findSelectableTrack: (id) => audioCatalog.findSelectableTrack(id),
  resolveArtifact: async (id, version) => {
    const artifact = await resolveTemplateArtifact(id, version);
    return artifact ? { contentHash: artifact.contentHash } : null;
  },
  signDownloadUrl: (key) =>
    getStorage().createDownloadUrl(key, STORAGE_LIMITS.downloadUrlTtlSeconds),
};
