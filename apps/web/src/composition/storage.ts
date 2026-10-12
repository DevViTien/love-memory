import {
  createLocalObjectStorage,
  createVercelBlobObjectStorage,
  getStorageConfiguration,
  getStorageEnvironment,
  type ObjectStorage,
} from "@love-memory/storage";

// Throws on a storage configuration error. Callers assign the result only after it succeeds, so a
// failed construction is never cached and a corrected environment recovers after a restart.
// Shared by media, the viewer payload and template artifacts, which use the same driver.
export function createStorage(): ObjectStorage {
  const configuration = getStorageConfiguration();
  return configuration.driver === "local"
    ? createLocalObjectStorage(configuration)
    : createVercelBlobObjectStorage({ credentials: getStorageEnvironment });
}
