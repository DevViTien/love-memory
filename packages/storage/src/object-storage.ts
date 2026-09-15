import "server-only";

import {
  del,
  get,
  head,
  issueSignedToken,
  presignUrl,
  put,
  type GetBlobResult,
  type HeadBlobResult,
  type IssueSignedTokenOptions,
  type IssuedSignedToken,
  type PresignUrlOptions,
  type PresignUrlResult,
  type PutBlobResult,
} from "@vercel/blob";

import { type StorageEnvironment } from "./environment";

export const STORAGE_LIMITS = {
  downloadUrlTtlSeconds: 300,
  maximumDownloadBytes: 10 * 1024 * 1024,
  uploadUrlTtlSeconds: 300,
} as const;

export type ObjectMetadata = Readonly<{
  contentLength: number;
  contentType: string;
  etag?: string;
}>;

export type PresignedUpload = Readonly<{
  expiresAt: Date;
  headers: Readonly<Record<string, string>>;
  method: "PUT";
  url: string;
}>;

export interface ObjectStorage {
  createDownloadUrl: (key: string, expiresInSeconds?: number) => Promise<string>;
  createUpload: (input: {
    contentType: string;
    expiresInSeconds?: number;
    key: string;
    maximumSizeInBytes: number;
  }) => Promise<PresignedUpload>;
  deleteObject: (key: string) => Promise<void>;
  getObject: (key: string, maximumBytes?: number) => Promise<Uint8Array>;
  getObjectMetadata: (key: string) => Promise<ObjectMetadata>;
  putObject: (input: {
    body: Uint8Array;
    cacheControlMaxAge?: number;
    contentType: string;
    key: string;
  }) => Promise<void>;
}

export class InvalidStoredObjectError extends Error {
  override readonly name = "InvalidStoredObjectError";
}

export class StoredObjectTooLargeError extends Error {
  override readonly name = "StoredObjectTooLargeError";
}

type BlobGet = (
  key: string,
  options: StorageEnvironment & { access: "private"; useCache: false },
) => Promise<GetBlobResult | null>;
type BlobHead = (key: string, options: StorageEnvironment) => Promise<HeadBlobResult>;
type BlobDelete = (key: string, options: StorageEnvironment) => Promise<void>;
type BlobPut = (
  key: string,
  body: Buffer,
  options: StorageEnvironment & {
    access: "private";
    addRandomSuffix: false;
    allowOverwrite: false;
    cacheControlMaxAge?: number;
    contentType: string;
  },
) => Promise<PutBlobResult>;
type IssueToken = (options: IssueSignedTokenOptions) => Promise<IssuedSignedToken>;
type Presign = (
  token: Pick<IssuedSignedToken, "clientSigningToken" | "delegationToken">,
  options: PresignUrlOptions & { access: "private" },
) => Promise<PresignUrlResult>;

export type VercelBlobStorageDependencies = Readonly<{
  credentials: () => StorageEnvironment;
  deleteBlob?: BlobDelete;
  getBlob?: BlobGet;
  headBlob?: BlobHead;
  issueToken?: IssueToken;
  now?: () => Date;
  presign?: Presign;
  putBlob?: BlobPut;
}>;

async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) break;

      length += result.value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new StoredObjectTooLargeError("Stored object exceeds the download limit.");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createVercelBlobObjectStorage({
  credentials,
  deleteBlob = del,
  getBlob = get,
  headBlob = head,
  issueToken = issueSignedToken,
  now = () => new Date(),
  presign = presignUrl,
  putBlob = put,
}: VercelBlobStorageDependencies): ObjectStorage {
  async function createPresignedUrl(
    key: string,
    operation: "get" | "put",
    expiresInSeconds: number,
    constraints: Readonly<{ contentType?: string; maximumSizeInBytes?: number }> = {},
  ): Promise<Readonly<{ expiresAt: Date; url: string }>> {
    const expiresAt = new Date(now().getTime() + expiresInSeconds * 1000);
    const allowedContentTypes = constraints.contentType ? [constraints.contentType] : undefined;
    const maximumSize = constraints.maximumSizeInBytes;
    const signedToken = await issueToken({
      ...credentials(),
      ...(allowedContentTypes ? { allowedContentTypes } : {}),
      ...(maximumSize === undefined ? {} : { maximumSizeInBytes: maximumSize }),
      operations: [operation],
      pathname: key,
      validUntil: expiresAt.getTime(),
    });
    const result = await presign(signedToken, {
      access: "private",
      ...(allowedContentTypes ? { allowedContentTypes } : {}),
      ...(maximumSize === undefined ? {} : { maximumSizeInBytes: maximumSize }),
      operation,
      pathname: key,
      validUntil: expiresAt.getTime(),
    });

    return { expiresAt, url: result.presignedUrl };
  }

  return {
    async createDownloadUrl(key, expiresInSeconds = STORAGE_LIMITS.downloadUrlTtlSeconds) {
      return (await createPresignedUrl(key, "get", expiresInSeconds)).url;
    },

    async createUpload({
      contentType,
      expiresInSeconds = STORAGE_LIMITS.uploadUrlTtlSeconds,
      key,
      maximumSizeInBytes,
    }) {
      const upload = await createPresignedUrl(key, "put", expiresInSeconds, {
        contentType,
        maximumSizeInBytes,
      });

      return {
        expiresAt: upload.expiresAt,
        headers: { "content-type": contentType },
        method: "PUT",
        url: upload.url,
      };
    },

    async deleteObject(key) {
      await deleteBlob(key, credentials());
    },

    async getObject(key, maximumBytes = STORAGE_LIMITS.maximumDownloadBytes) {
      const result = await getBlob(key, {
        ...credentials(),
        access: "private",
        useCache: false,
      });

      if (!result || result.statusCode !== 200 || !result.stream) {
        throw new InvalidStoredObjectError("Stored object has no readable body.");
      }
      if (result.blob.size > maximumBytes) {
        await result.stream.cancel();
        throw new StoredObjectTooLargeError("Stored object exceeds the download limit.");
      }
      return readBoundedStream(result.stream, maximumBytes);
    },

    async getObjectMetadata(key) {
      const result = await headBlob(key, credentials());

      if (!result.contentType || !Number.isSafeInteger(result.size) || result.size < 0) {
        throw new InvalidStoredObjectError("Stored object is missing required metadata.");
      }

      return {
        contentLength: result.size,
        contentType: result.contentType,
        ...(result.etag ? { etag: result.etag } : {}),
      };
    },

    async putObject({ body, cacheControlMaxAge, contentType, key }) {
      await putBlob(key, Buffer.from(body), {
        ...credentials(),
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        ...(cacheControlMaxAge === undefined ? {} : { cacheControlMaxAge }),
        contentType,
      });
    },
  };
}
