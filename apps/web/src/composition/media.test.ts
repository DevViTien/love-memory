// @vitest-environment node
import type * as StorageModule from "@love-memory/storage";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storageSpies = vi.hoisted(() => ({
  createLocalObjectStorage: vi.fn(),
  createVercelBlobObjectStorage: vi.fn(),
}));

vi.mock("@love-memory/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof StorageModule>();
  storageSpies.createLocalObjectStorage.mockImplementation(actual.createLocalObjectStorage);
  storageSpies.createVercelBlobObjectStorage.mockImplementation(
    actual.createVercelBlobObjectStorage,
  );
  return { ...actual, ...storageSpies };
});
vi.mock("@/modules/gifts/infrastructure/mongo-gift-repository", () => ({
  mongoGiftRepository: {},
}));
const outboxMonitor = vi.hoisted(() => ({ hasOverdueJob: vi.fn() }));
vi.mock("@/modules/media/infrastructure/mongo-media-repository", () => ({
  mongoMediaAssetRepository: {},
  mongoMediaOutboxMonitor: outboxMonitor,
  mongoMediaWorkerRepository: {},
}));
vi.mock("@/composition/gifts", () => ({ getGiftTemplateManifest: vi.fn() }));

const secret = "composition-local-object-storage-secret";

async function loadComposition() {
  vi.resetModules();
  const composition = await import("./media");
  const storage = await import("@love-memory/storage");
  return { composition, storage };
}

function stubLocal(vercelEnvironment = "") {
  vi.stubEnv("STORAGE_DRIVER", "local");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3100");
  vi.stubEnv("LOCAL_OBJECT_STORAGE_SECRET", secret);
  vi.stubEnv("VERCEL_ENV", vercelEnvironment);
}

beforeEach(() => {
  storageSpies.createLocalObjectStorage.mockClear();
  storageSpies.createVercelBlobObjectStorage.mockClear();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("BLOB_STORE_ID", "");
  vi.stubEnv("VERCEL_OIDC_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("media composition storage", () => {
  it("throws on every call while the local driver is refused, without caching", async () => {
    stubLocal("preview");
    const { composition, storage } = await loadComposition();
    expect(() => composition.getMediaService()).toThrow(storage.StorageConfigurationError);
    expect(() => composition.getMediaService()).toThrow(storage.StorageConfigurationError);
    expect(() => composition.getMediaWorker()).toThrow(storage.StorageConfigurationError);
    expect(() => composition.getMediaSpikeService()).toThrow(storage.StorageConfigurationError);
    expect(composition.getLocalObjectStorageRoute()).toBeNull();
    expect(storageSpies.createLocalObjectStorage).not.toHaveBeenCalled();

    vi.stubEnv("VERCEL_ENV", "");
    expect(composition.getMediaService()).toBeDefined();
  });

  it("keeps the Blob adapter with lazily resolved credentials by default", async () => {
    vi.stubEnv("STORAGE_DRIVER", "");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "blob-token");
    const { composition, storage } = await loadComposition();
    const service = composition.getMediaService();
    expect(composition.getMediaService()).toBe(service);
    expect(composition.getMediaWorker()).toBeDefined();
    expect(storageSpies.createVercelBlobObjectStorage).toHaveBeenCalledWith({
      credentials: storage.getStorageEnvironment,
    });
    expect(storageSpies.createLocalObjectStorage).not.toHaveBeenCalled();
    expect(composition.getLocalObjectStorageRoute()).toBeNull();
  });

  it("builds the local adapter under the workspace directory in local mode", async () => {
    stubLocal("development");
    const { composition } = await loadComposition();
    composition.getMediaService();
    expect(storageSpies.createLocalObjectStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        driver: "local",
        publicOrigin: "http://127.0.0.1:3100",
        rootDirectory: expect.stringMatching(
          new RegExp(`${join(".tmp", "object-storage").replace(/\\/g, "\\\\")}$`),
        ) as unknown,
      }),
    );
    const route = composition.getLocalObjectStorageRoute();
    expect(route?.verifyRequest).toBeTypeOf("function");
    expect(storageSpies.createVercelBlobObjectStorage).not.toHaveBeenCalled();
  });

  it("checks the media outbox through the Mongo monitor", async () => {
    const { composition } = await loadComposition();
    outboxMonitor.hasOverdueJob.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(composition.checkMediaOutbox()).resolves.toBeUndefined();
    await expect(composition.checkMediaOutbox()).rejects.toMatchObject({
      name: "MediaOutboxStalledError",
    });
  });
});
