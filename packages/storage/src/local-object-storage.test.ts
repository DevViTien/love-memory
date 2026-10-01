import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InvalidObjectKeyError } from "./local-object-key";
import { createLocalObjectStorage, type LocalObjectStorage } from "./local-object-storage";
import {
  InvalidStoredObjectError,
  ObjectAlreadyExistsError,
  ObjectNotFoundError,
  StoredObjectTooLargeError,
} from "./object-storage";

const secret = "local-object-storage-test-secret-0001";
const origin = "http://127.0.0.1:3100";
const issuedAt = new Date("2026-10-01T00:00:00.000Z");
const key = "private/assets/0f8fad5b-d9cb-469f-a165-70867728950e/source";
const derivativeKey = "private/assets/0f8fad5b-d9cb-469f-a165-70867728950e/derivatives/w768.webp";

let rootDirectory: string;
let storage: LocalObjectStorage;
let clock: Date;

beforeEach(async () => {
  rootDirectory = await mkdtemp(join(tmpdir(), "lm-local-storage-"));
  clock = issuedAt;
  storage = createLocalObjectStorage({
    now: () => clock,
    publicOrigin: origin,
    rootDirectory,
    signingSecret: secret,
  });
});

afterEach(async () => {
  await rm(rootDirectory, { force: true, recursive: true });
});

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function incomingEntries(): Promise<string[]> {
  return readdir(join(rootDirectory, "incoming")).catch(() => []);
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("local object storage adapter", () => {
  it("issues upload grants with the Blob grant shape and TTL", async () => {
    const upload = await storage.createUpload({
      contentType: "image/jpeg",
      expiresInSeconds: 900,
      key,
      maximumSizeInBytes: 4096,
    });
    expect(upload.method).toBe("PUT");
    expect(upload.headers).toEqual({ "content-type": "image/jpeg" });
    expect(upload.expiresAt).toEqual(new Date(issuedAt.getTime() + 900_000));
    const url = new URL(upload.url);
    expect(url.origin).toBe(origin);
    expect(url.pathname).toBe(`/api/local-object-storage/${key}`);
    expect(url.searchParams.get("maxBytes")).toBe("4096");
    expect(
      storage.verifyRequest({ key, method: "PUT", parameters: url.searchParams }),
    ).toMatchObject({ contentType: "image/jpeg", maxBytes: 4096, ok: true });
    await expect(
      storage.createUpload({ contentType: "text/html", key, maximumSizeInBytes: 1 }),
    ).rejects.toThrow();
  });

  it("issues download URLs that expire after 300 seconds by default", async () => {
    const url = new URL(await storage.createDownloadUrl(key));
    expect(url.searchParams.get("expires")).toBe(String(issuedAt.getTime() / 1000 + 300));
    expect(storage.verifyRequest({ key, method: "GET", parameters: url.searchParams }).ok).toBe(
      true,
    );
    clock = new Date(issuedAt.getTime() + 300_000);
    expect(storage.verifyRequest({ key, method: "GET", parameters: url.searchParams }).ok).toBe(
      false,
    );
    const custom = new URL(await storage.createDownloadUrl(key, 60));
    expect(custom.searchParams.get("expires")).toBe(String(issuedAt.getTime() / 1000 + 360));
  });

  it("writes, describes, reads and streams an object", async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    await storage.putObject({ body, cacheControlMaxAge: 60, contentType: "image/webp", key });
    const metadata = await storage.getObjectMetadata(key);
    expect(metadata).toEqual({
      contentLength: 4,
      contentType: "image/webp",
      etag: `"${createHash("sha256").update(body).digest("hex")}"`,
    });
    expect(await storage.getObject(key)).toEqual(body);
    expect(await storage.hasObject(key)).toBe(true);
    const opened = await storage.openObject(key);
    expect(opened.metadata.contentLength).toBe(4);
    expect(await readAll(opened.body)).toEqual(body);
    expect(await incomingEntries()).toEqual([]);
  });

  it("raises the not-found error for a missing object", async () => {
    await expect(storage.getObjectMetadata(key)).rejects.toBeInstanceOf(ObjectNotFoundError);
    await expect(storage.getObject(key)).rejects.toBeInstanceOf(ObjectNotFoundError);
    await expect(storage.openObject(key)).rejects.toBeInstanceOf(ObjectNotFoundError);
    expect(await storage.hasObject(key)).toBe(false);
  });

  it("raises the invalid-object error for malformed metadata or missing bytes", async () => {
    await storage.putObject({ body: new Uint8Array([1]), contentType: "image/webp", key });
    const metadataFile = join(rootDirectory, "metadata", ...`${key}.json`.split("/"));
    await writeFile(metadataFile, "{not json");
    await expect(storage.getObjectMetadata(key)).rejects.toBeInstanceOf(InvalidStoredObjectError);
    await writeFile(metadataFile, JSON.stringify({ contentLength: -1, contentType: "" }));
    await expect(storage.getObject(key)).rejects.toBeInstanceOf(InvalidStoredObjectError);
    await expect(storage.hasObject(key)).rejects.toBeInstanceOf(InvalidStoredObjectError);

    await writeFile(
      metadataFile,
      JSON.stringify({
        contentLength: 5,
        contentType: "image/webp",
        createdAt: issuedAt.toISOString(),
        etag: '"x"',
      }),
    );
    await expect(storage.getObject(key)).rejects.toBeInstanceOf(InvalidStoredObjectError);
    await rm(join(rootDirectory, "objects", ...key.split("/")));
    await expect(storage.openObject(key)).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it("refuses a bounded read of an over-limit object", async () => {
    await storage.putObject({ body: new Uint8Array(10), contentType: "image/webp", key });
    await expect(storage.getObject(key, 9)).rejects.toBeInstanceOf(StoredObjectTooLargeError);
    expect(await storage.getObject(key, 10)).toHaveLength(10);
  });

  it("refuses to overwrite unless overwrite is requested", async () => {
    await storage.putObject({ body: new Uint8Array([1]), contentType: "image/webp", key });
    await expect(
      storage.putObject({ body: new Uint8Array([2]), contentType: "image/webp", key }),
    ).rejects.toBeInstanceOf(ObjectAlreadyExistsError);
    expect(await storage.getObject(key)).toEqual(new Uint8Array([1]));

    await storage.putObject({
      allowOverwrite: true,
      body: new Uint8Array([3, 4]),
      contentType: "image/webp",
      key: derivativeKey,
    });
    await storage.putObject({
      allowOverwrite: true,
      body: new Uint8Array([5]),
      contentType: "image/webp",
      key: derivativeKey,
    });
    expect(await storage.getObject(derivativeKey)).toEqual(new Uint8Array([5]));
    expect(await incomingEntries()).toEqual([]);
  });

  it("deletes idempotently", async () => {
    await storage.putObject({ body: new Uint8Array([1]), contentType: "image/webp", key });
    await storage.deleteObject(key);
    await storage.deleteObject(key);
    await expect(storage.getObjectMetadata(key)).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it("refuses invalid keys for every operation", async () => {
    const invalid = "private/../secret";
    await expect(storage.createDownloadUrl(invalid)).rejects.toThrow();
    await expect(
      storage.createUpload({ contentType: "image/jpeg", key: invalid, maximumSizeInBytes: 1 }),
    ).rejects.toThrow();
    for (const operation of [
      storage.getObject(invalid),
      storage.getObjectMetadata(invalid),
      storage.deleteObject(invalid),
      storage.putObject({ body: new Uint8Array([1]), contentType: "image/webp", key: invalid }),
      storage.writeUpload({
        body: streamOf(new Uint8Array([1])),
        contentType: "image/jpeg",
        key: invalid,
        maximumBytes: 1,
      }),
    ]) {
      await expect(operation).rejects.toBeInstanceOf(InvalidObjectKeyError);
    }
    expect(await readdir(rootDirectory)).toEqual([]);
  });
});

describe("local upload writes", () => {
  it("stores a body of exactly the signed size with its type, length and SHA-256 tag", async () => {
    const first = new Uint8Array(2048).fill(7);
    const second = new Uint8Array(2048).fill(9);
    await storage.writeUpload({
      body: streamOf(first, second),
      contentType: "image/jpeg",
      key,
      maximumBytes: 4096,
    });
    const hash = createHash("sha256").update(first).update(second).digest("hex");
    expect(await storage.getObjectMetadata(key)).toEqual({
      contentLength: 4096,
      contentType: "image/jpeg",
      etag: `"${hash}"`,
    });
    const stored = await readFile(join(rootDirectory, "objects", ...key.split("/")));
    expect(stored.byteLength).toBe(4096);
    expect(await incomingEntries()).toEqual([]);
  });

  it("rejects a body one byte over the limit and leaves no object or partial file", async () => {
    await expect(
      storage.writeUpload({
        body: streamOf(new Uint8Array(4096), new Uint8Array(1)),
        contentType: "image/jpeg",
        key,
        maximumBytes: 4096,
      }),
    ).rejects.toBeInstanceOf(StoredObjectTooLargeError);
    expect(await storage.hasObject(key)).toBe(false);
    await expect(readFile(join(rootDirectory, "objects", ...key.split("/")))).rejects.toThrow();
    expect(await incomingEntries()).toEqual([]);
  });

  it("refuses a second commit to the same key and keeps the first object", async () => {
    await storage.writeUpload({
      body: streamOf(new Uint8Array([1])),
      contentType: "image/jpeg",
      key,
      maximumBytes: 10,
    });
    await expect(
      storage.writeUpload({
        body: streamOf(new Uint8Array([2, 2])),
        contentType: "image/jpeg",
        key,
        maximumBytes: 10,
      }),
    ).rejects.toBeInstanceOf(ObjectAlreadyExistsError);
    expect(await storage.getObject(key)).toEqual(new Uint8Array([1]));
    expect(await incomingEntries()).toEqual([]);
  });

  it("replaces bytes left without metadata by an interrupted commit", async () => {
    await storage.writeUpload({
      body: streamOf(new Uint8Array([1])),
      contentType: "image/jpeg",
      key,
      maximumBytes: 10,
    });
    // Simulate a crash after the link but before the metadata write.
    await rm(join(rootDirectory, "metadata", ...`${key}.json`.split("/")));
    await expect(storage.hasObject(key)).resolves.toBe(false);

    await storage.writeUpload({
      body: streamOf(new Uint8Array([2, 2])),
      contentType: "image/jpeg",
      key,
      maximumBytes: 10,
    });
    expect(await storage.getObject(key)).toEqual(new Uint8Array([2, 2]));
    expect((await storage.getObjectMetadata(key)).contentLength).toBe(2);
    expect(await incomingEntries()).toEqual([]);
  });

  it("accepts an empty body", async () => {
    await storage.writeUpload({ body: null, contentType: "image/png", key, maximumBytes: 10 });
    expect((await storage.getObjectMetadata(key)).contentLength).toBe(0);
  });
});
