import { type GetBlobResult, type HeadBlobResult, type PutBlobResult } from "@vercel/blob";
import { describe, expect, it, vi } from "vitest";

import {
  createVercelBlobObjectStorage,
  InvalidStoredObjectError,
  StoredObjectTooLargeError,
} from "./object-storage";

const credentials = () => ({ token: "test-token" }) as const;
const issuedToken = {
  clientSigningToken: "client-signing-token",
  delegationToken: "delegation-token",
  validUntil: Date.parse("2026-09-15T00:05:00.000Z"),
};

function createHead(overrides: Partial<HeadBlobResult> = {}): HeadBlobResult {
  return {
    cacheControl: "private, max-age=60",
    contentDisposition: 'inline; filename="source"',
    contentType: "image/png",
    downloadUrl: "https://store.private.blob.vercel-storage.com/source?download=1",
    etag: '"etag"',
    pathname: "private/spikes/asset/source",
    size: 3,
    uploadedAt: new Date("2026-09-15T00:00:00.000Z"),
    url: "https://store.private.blob.vercel-storage.com/source",
    ...overrides,
  };
}

function createPutResult(): PutBlobResult {
  return {
    contentDisposition: 'inline; filename="w768.webp"',
    contentType: "image/webp",
    downloadUrl: "https://store.private.blob.vercel-storage.com/w768.webp?download=1",
    etag: '"etag"',
    pathname: "processed/spikes/asset/w768.webp",
    url: "https://store.private.blob.vercel-storage.com/w768.webp",
  };
}

function createGetResult(bytes: Uint8Array): GetBlobResult {
  const head = createHead({ size: bytes.byteLength });
  return {
    blob: head,
    headers: new Headers({ "content-type": head.contentType }),
    statusCode: 200,
    stream: new Blob([bytes]).stream(),
  };
}

describe("Vercel Blob object storage", () => {
  it("creates a pathname-, MIME-, size- and time-scoped upload URL", async () => {
    const issueToken = vi.fn(() => Promise.resolve(issuedToken));
    const presign = vi.fn(() =>
      Promise.resolve({ presignedUrl: "https://blob.vercel-storage.com?signature=safe" }),
    );
    const storage = createVercelBlobObjectStorage({
      credentials,
      issueToken,
      now: () => new Date("2026-09-15T00:00:00.000Z"),
      presign,
    });

    await expect(
      storage.createUpload({
        contentType: "image/jpeg",
        expiresInSeconds: 60,
        key: "private/spikes/asset/source",
        maximumSizeInBytes: 1024,
      }),
    ).resolves.toEqual({
      expiresAt: new Date("2026-09-15T00:01:00.000Z"),
      headers: { "content-type": "image/jpeg" },
      method: "PUT",
      url: "https://blob.vercel-storage.com?signature=safe",
    });
    expect(issueToken).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedContentTypes: ["image/jpeg"],
        maximumSizeInBytes: 1024,
        operations: ["put"],
        pathname: "private/spikes/asset/source",
        token: "test-token",
      }),
    );
    expect(presign).toHaveBeenCalledWith(
      issuedToken,
      expect.objectContaining({
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        operation: "put",
      }),
    );
  });

  it("reads metadata and bounded object bytes with a consistent private read", async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const getBlob = vi.fn(() => Promise.resolve(createGetResult(bytes)));
    const storage = createVercelBlobObjectStorage({
      credentials,
      getBlob,
      headBlob: vi.fn(() => Promise.resolve(createHead())),
    });

    await expect(storage.getObjectMetadata("source")).resolves.toEqual({
      contentLength: 3,
      contentType: "image/png",
      etag: '"etag"',
    });
    await expect(storage.getObject("source", 3)).resolves.toEqual(bytes);
    expect(getBlob).toHaveBeenCalledWith("source", {
      access: "private",
      token: "test-token",
      useCache: false,
    });
  });

  it("writes, signs and deletes private blobs", async () => {
    const deleteBlob = vi.fn(() => Promise.resolve());
    const issueToken = vi.fn(() => Promise.resolve(issuedToken));
    const presign = vi.fn(() =>
      Promise.resolve({
        presignedUrl: "https://store.private.blob.vercel-storage.com/result?signed=true",
      }),
    );
    const putBlob = vi.fn(() => Promise.resolve(createPutResult()));
    const storage = createVercelBlobObjectStorage({
      credentials,
      deleteBlob,
      issueToken,
      presign,
      putBlob,
    });

    await storage.putObject({
      body: Uint8Array.from([1]),
      cacheControlMaxAge: 60,
      contentType: "image/webp",
      key: "processed/asset.webp",
    });
    await storage.deleteObject("private/asset/source");
    await expect(storage.createDownloadUrl("processed/asset.webp", 30)).resolves.toContain(
      "signed=true",
    );

    expect(putBlob).toHaveBeenCalledWith(
      "processed/asset.webp",
      expect.any(Uint8Array),
      expect.objectContaining({ access: "private", allowOverwrite: false }),
    );
    expect(deleteBlob).toHaveBeenCalledWith("private/asset/source", { token: "test-token" });
    expect(issueToken).toHaveBeenCalledWith(
      expect.objectContaining({ operations: ["get"], pathname: "processed/asset.webp" }),
    );
  });

  it("rejects missing bodies and reads that exceed the bound", async () => {
    const missingStorage = createVercelBlobObjectStorage({
      credentials,
      getBlob: vi.fn(() => Promise.resolve(null)),
    });
    await expect(missingStorage.getObject("source")).rejects.toBeInstanceOf(
      InvalidStoredObjectError,
    );

    const oversizedStorage = createVercelBlobObjectStorage({
      credentials,
      getBlob: vi.fn(() => Promise.resolve(createGetResult(Uint8Array.from([1, 2])))),
    });
    await expect(oversizedStorage.getObject("source", 1)).rejects.toBeInstanceOf(
      StoredObjectTooLargeError,
    );
  });
});
