import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import { resolveObjectPath } from "./local-object-key";
import {
  LOCAL_OBJECT_CONTENT_TYPES,
  type LocalObjectContentType,
  type LocalObjectVerification,
  signLocalObjectUrl,
  verifyLocalObjectRequest,
} from "./local-object-signing";
import {
  InvalidStoredObjectError,
  ObjectAlreadyExistsError,
  type ObjectMetadata,
  ObjectNotFoundError,
  type ObjectStorage,
  STORAGE_LIMITS,
  StoredObjectTooLargeError,
} from "./object-storage";

const READ_CHUNK_BYTES = 64 * 1024;

const StoredMetadataSchema = z.object({
  contentLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  contentType: z.string().min(1).max(255),
  createdAt: z.iso.datetime(),
  etag: z.string().min(1).max(128),
});

type StoredMetadata = z.output<typeof StoredMetadataSchema>;

export type LocalObjectStorageOptions = Readonly<{
  now?: () => Date;
  publicOrigin: string;
  rootDirectory: string;
  signingSecret: string;
}>;

export type LocalObjectRead = Readonly<{
  body: ReadableStream<Uint8Array>;
  metadata: ObjectMetadata;
}>;

/**
 * The object storage port plus the operations the same-origin local route needs. Nothing here
 * logs keys, paths or URLs.
 */
export interface LocalObjectStorage extends ObjectStorage {
  hasObject: (key: string) => Promise<boolean>;
  openObject: (key: string) => Promise<LocalObjectRead>;
  verifyRequest: (
    input: Readonly<{ key: string; method: string; parameters: URLSearchParams }>,
  ) => LocalObjectVerification;
  writeUpload: (
    input: Readonly<{
      body: ReadableStream<Uint8Array> | null;
      contentType: LocalObjectContentType;
      key: string;
      maximumBytes: number;
    }>,
  ) => Promise<void>;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function ignoreMissing(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
  }
}

function isLocalObjectContentType(value: string): value is LocalObjectContentType {
  return LOCAL_OBJECT_CONTENT_TYPES.some((type) => type === value);
}

export function createLocalObjectStorage({
  now = () => new Date(),
  publicOrigin,
  rootDirectory,
  signingSecret,
}: LocalObjectStorageOptions): LocalObjectStorage {
  const objectsDirectory = join(rootDirectory, "objects");
  const metadataDirectory = join(rootDirectory, "metadata");
  const incomingDirectory = join(rootDirectory, "incoming");

  const objectPath = (key: string) => resolveObjectPath(objectsDirectory, key);
  const metadataPath = (key: string) => resolveObjectPath(metadataDirectory, key, ".json");

  async function incomingFile(): Promise<string> {
    await mkdir(incomingDirectory, { recursive: true });
    return join(incomingDirectory, randomUUID());
  }

  async function readMetadata(key: string): Promise<StoredMetadata> {
    let text: string;
    try {
      text = await readFile(metadataPath(key), "utf8");
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        throw new ObjectNotFoundError("Stored object does not exist.");
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new InvalidStoredObjectError("Stored object is missing required metadata.");
    }
    const metadata = StoredMetadataSchema.safeParse(parsed);
    if (!metadata.success) {
      throw new InvalidStoredObjectError("Stored object is missing required metadata.");
    }
    return metadata.data;
  }

  async function hasMetadataFile(key: string): Promise<boolean> {
    try {
      await stat(metadataPath(key));
      return true;
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return false;
      throw error;
    }
  }

  // The metadata file is the commit point: an object exists only once its metadata exists.
  async function writeMetadata(key: string, metadata: StoredMetadata): Promise<void> {
    const target = metadataPath(key);
    const temporary = await incomingFile();
    try {
      await writeFile(temporary, JSON.stringify(metadata), { flag: "wx" });
      await mkdir(dirname(target), { recursive: true });
      await rename(temporary, target);
    } finally {
      await ignoreMissing(rm(temporary));
    }
  }

  async function commitObject(
    key: string,
    temporary: string,
    allowOverwrite: boolean,
    metadata: Omit<StoredMetadata, "createdAt">,
  ): Promise<void> {
    const target = objectPath(key);
    await mkdir(dirname(target), { recursive: true });
    if (allowOverwrite) {
      await rename(temporary, target);
    } else {
      try {
        // A hard link fails with EEXIST instead of replacing the target, so no upload overwrites.
        await link(temporary, target);
      } catch (error) {
        if (!hasErrorCode(error, "EEXIST")) throw error;
        // Metadata is the commit point: bytes without metadata are the orphan of a crash between
        // the link and the metadata write, never a stored object, so they are replaced.
        if (await hasMetadataFile(key)) {
          throw new ObjectAlreadyExistsError("Stored object already exists.");
        }
        await rename(temporary, target);
      }
    }
    await writeMetadata(key, { ...metadata, createdAt: now().toISOString() });
  }

  function expiresAfter(seconds: number): Date {
    return new Date(now().getTime() + seconds * 1000);
  }

  function toObjectMetadata(metadata: StoredMetadata): ObjectMetadata {
    return {
      contentLength: metadata.contentLength,
      contentType: metadata.contentType,
      etag: metadata.etag,
    };
  }

  async function openBody(key: string, metadata: StoredMetadata) {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(objectPath(key), "r");
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        throw new ObjectNotFoundError("Stored object does not exist.");
      }
      throw error;
    }
    const { size } = await handle.stat();
    if (size !== metadata.contentLength) {
      await handle.close();
      throw new InvalidStoredObjectError("Stored object does not match its metadata.");
    }
    return handle;
  }

  return {
    createDownloadUrl(key, expiresInSeconds = STORAGE_LIMITS.downloadUrlTtlSeconds) {
      return Promise.resolve().then(() =>
        signLocalObjectUrl({
          expiresAt: expiresAfter(expiresInSeconds),
          key,
          method: "GET",
          publicOrigin,
          secret: signingSecret,
        }),
      );
    },

    createUpload({
      contentType,
      expiresInSeconds = STORAGE_LIMITS.uploadUrlTtlSeconds,
      key,
      maximumSizeInBytes,
    }) {
      return Promise.resolve().then(() => {
        if (!isLocalObjectContentType(contentType)) {
          throw new InvalidStoredObjectError("The local storage driver does not accept this type.");
        }
        const expiresAt = expiresAfter(expiresInSeconds);
        return {
          expiresAt,
          headers: { "content-type": contentType },
          method: "PUT" as const,
          url: signLocalObjectUrl({
            contentType,
            expiresAt,
            key,
            maxBytes: maximumSizeInBytes,
            method: "PUT",
            publicOrigin,
            secret: signingSecret,
          }),
        };
      });
    },

    async deleteObject(key) {
      // Readers stop seeing the object as soon as its metadata is gone.
      await ignoreMissing(rm(metadataPath(key)));
      await ignoreMissing(rm(objectPath(key)));
    },

    async getObject(key, maximumBytes = STORAGE_LIMITS.maximumDownloadBytes) {
      const metadata = await readMetadata(key);
      if (metadata.contentLength > maximumBytes) {
        throw new StoredObjectTooLargeError("Stored object exceeds the download limit.");
      }
      const handle = await openBody(key, metadata);
      try {
        return new Uint8Array(await handle.readFile());
      } finally {
        await handle.close();
      }
    },

    async getObjectMetadata(key) {
      return toObjectMetadata(await readMetadata(key));
    },

    async hasObject(key) {
      try {
        await readMetadata(key);
        return true;
      } catch (error) {
        if (error instanceof ObjectNotFoundError) return false;
        throw error;
      }
    },

    async openObject(key) {
      const metadata = await readMetadata(key);
      const handle = await openBody(key, metadata);
      const body = new ReadableStream<Uint8Array>({
        async cancel() {
          await handle.close();
        },
        async pull(controller) {
          try {
            const buffer = new Uint8Array(READ_CHUNK_BYTES);
            const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
            if (bytesRead === 0) {
              await handle.close();
              controller.close();
              return;
            }
            controller.enqueue(buffer.subarray(0, bytesRead));
          } catch (error) {
            await handle.close().catch(() => undefined);
            controller.error(error);
          }
        },
      });
      return { body, metadata: toObjectMetadata(metadata) };
    },

    async putObject({ allowOverwrite = false, body, contentType, key }) {
      // cacheControlMaxAge is ignored: local downloads are always private and uncached.
      objectPath(key);
      const temporary = await incomingFile();
      try {
        await writeFile(temporary, body, { flag: "wx" });
        await commitObject(key, temporary, allowOverwrite, {
          contentLength: body.byteLength,
          contentType,
          etag: `"${createHash("sha256").update(body).digest("hex")}"`,
        });
      } finally {
        await ignoreMissing(rm(temporary));
      }
    },

    verifyRequest({ key, method, parameters }) {
      return verifyLocalObjectRequest({
        key,
        method,
        now: now(),
        parameters,
        secret: signingSecret,
      });
    },

    async writeUpload({ body, contentType, key, maximumBytes }) {
      objectPath(key);
      const temporary = await incomingFile();
      const hash = createHash("sha256");
      let length = 0;
      try {
        const handle = await open(temporary, "wx");
        try {
          const reader = body?.getReader();
          try {
            while (reader) {
              const chunk = await reader.read();
              if (chunk.done) break;
              length += chunk.value.byteLength;
              if (length > maximumBytes) {
                await reader.cancel();
                throw new StoredObjectTooLargeError("The upload exceeds its signed size.");
              }
              hash.update(chunk.value);
              await handle.write(chunk.value);
            }
          } finally {
            reader?.releaseLock();
          }
        } finally {
          await handle.close();
        }
        await commitObject(key, temporary, false, {
          contentLength: length,
          contentType,
          etag: `"${hash.digest("hex")}"`,
        });
      } finally {
        await ignoreMissing(rm(temporary));
      }
    },
  };
}
