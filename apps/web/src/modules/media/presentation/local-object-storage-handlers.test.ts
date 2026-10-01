// @vitest-environment node
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalObjectStorage, type LocalObjectStorage } from "@love-memory/storage";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { reportOperationalFailure } from "@/observability/operational-errors";

import {
  handleLocalObjectDownload,
  handleLocalObjectUpload,
  type LocalObjectRouteDependencies,
} from "./local-object-storage-handlers";

const secret = "handler-local-object-storage-secret-0001";
const origin = "http://127.0.0.1:3100";
const key = "private/assets/0f8fad5b-d9cb-469f-a165-70867728950e/source";
const segments = key.split("/");
const issuedAt = new Date("2026-10-01T00:00:00.000Z");

let rootDirectory: string;
let clock: Date;
let storage: LocalObjectStorage;
let dependencies: LocalObjectRouteDependencies & {
  reportFailure: Mock<typeof reportOperationalFailure>;
};

function create(signingSecret = secret) {
  return createLocalObjectStorage({
    now: () => clock,
    publicOrigin: origin,
    rootDirectory,
    signingSecret,
  });
}

beforeEach(async () => {
  rootDirectory = await mkdtemp(join(tmpdir(), "lm-local-route-"));
  clock = issuedAt;
  storage = create();
  dependencies = {
    getStorage: () => storage,
    reportFailure: vi.fn<typeof reportOperationalFailure>(),
  };
});

afterEach(async () => {
  await rm(rootDirectory, { force: true, recursive: true });
});

async function grant(maximumSizeInBytes = 4096) {
  return storage.createUpload({ contentType: "image/jpeg", key, maximumSizeInBytes });
}

function put(url: string, body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request(url, {
    body,
    headers: { "content-type": "image/jpeg", ...headers },
    method: "PUT",
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}

function streamBody(length: number): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(length));
      controller.close();
    },
  });
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

async function objectFiles(): Promise<string[]> {
  return readdir(join(rootDirectory, "objects"), { recursive: true }).catch(() => []);
}

function tamper(url: string, parameter: string): string {
  const parsed = new URL(url);
  const value = parsed.searchParams.get(parameter)!;
  parsed.searchParams.set(parameter, `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`);
  return parsed.toString();
}

describe("signed local upload", () => {
  it("stores the Studio upload and answers 204 (Studio upload succeeds)", async () => {
    const upload = await grant();
    const response = await handleLocalObjectUpload(
      put(upload.url, new Uint8Array(4096), upload.headers),
      segments,
      dependencies,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await storage.getObjectMetadata(key)).toMatchObject({
      contentLength: 4096,
      contentType: "image/jpeg",
    });
  });

  it("accepts a content type with parameters in any case", async () => {
    const upload = await grant();
    const response = await handleLocalObjectUpload(
      put(upload.url, new Uint8Array(1), { "content-type": "Image/JPEG; charset=binary" }),
      segments,
      dependencies,
    );
    expect(response.status).toBe(204);
  });

  it("rejects a mismatching content type with 415 (Wrong content type)", async () => {
    const upload = await grant();
    const response = await handleLocalObjectUpload(
      put(upload.url, new Uint8Array(1), { "content-type": "image/png" }),
      segments,
      dependencies,
    );
    expect(response.status).toBe(415);
    expect(await errorCode(response)).toBe("VALIDATION_ERROR");
    expect(await objectFiles()).toEqual([]);
  });

  it("rejects an oversized body with or without Content-Length (Oversized body)", async () => {
    const upload = await grant(4096);
    const declared = await handleLocalObjectUpload(
      put(upload.url, new Uint8Array(4097)),
      segments,
      dependencies,
    );
    expect(declared.status).toBe(413);
    expect(await errorCode(declared)).toBe("VALIDATION_ERROR");

    const streamed = await handleLocalObjectUpload(
      put(upload.url, streamBody(4097)),
      segments,
      dependencies,
    );
    expect(streamed.status).toBe(413);
    expect(await errorCode(streamed)).toBe("VALIDATION_ERROR");
    expect(await storage.hasObject(key)).toBe(false);
    expect(await objectFiles()).toEqual([]);
    expect(await readdir(join(rootDirectory, "incoming"))).toEqual([]);
  });

  it("refuses a second upload to the same key (Second upload to the same key)", async () => {
    const upload = await grant();
    const first = await handleLocalObjectUpload(
      put(upload.url, new Uint8Array([1, 2])),
      segments,
      dependencies,
    );
    expect(first.status).toBe(204);
    const second = await handleLocalObjectUpload(
      put(upload.url, new Uint8Array([3])),
      segments,
      dependencies,
    );
    expect(second.status).toBe(409);
    expect(await errorCode(second)).toBe("CONFLICT");
    expect(await storage.getObject(key)).toEqual(new Uint8Array([1, 2]));
  });

  it("maps a commit race to 409", async () => {
    const upload = await grant();
    const racing: LocalObjectStorage = {
      ...storage,
      writeUpload: async (input) => {
        await storage.putObject({ body: new Uint8Array([9]), contentType: "image/jpeg", key });
        return storage.writeUpload(input);
      },
    };
    const response = await handleLocalObjectUpload(put(upload.url, new Uint8Array([1])), segments, {
      ...dependencies,
      getStorage: () => racing,
    });
    expect(response.status).toBe(409);
  });
});

describe("signed local object URLs", () => {
  it("rejects tampered, re-keyed, expired, swapped and foreign-secret URLs with 403", async () => {
    await storage.putObject({ body: new Uint8Array([1]), contentType: "image/webp", key });
    const download = await storage.createDownloadUrl(key);
    const upload = (await grant()).url;
    const otherKey = "private/assets/1f8fad5b-d9cb-469f-a165-70867728950e/source";

    const cases: Array<[Request, readonly string[]]> = [
      [new Request(tamper(download, "signature")), segments],
      [new Request(download), otherKey.split("/")],
      [new Request(download.replace("expires=", "expires=1")), segments],
      [put(download, new Uint8Array([1])), segments],
      [new Request(upload), segments],
      [new Request(download.split("?")[0]!), segments],
    ];
    for (const [request, path] of cases) {
      const handler =
        request.method === "PUT" ? handleLocalObjectUpload : handleLocalObjectDownload;
      const response = await handler(request, path, dependencies);
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("FORBIDDEN");
    }

    clock = new Date(issuedAt.getTime() + 300_000);
    const expired = await handleLocalObjectDownload(new Request(download), segments, dependencies);
    expect(expired.status).toBe(403);
    const expiredUpload = await handleLocalObjectUpload(
      put(upload, new Uint8Array([1])),
      segments,
      dependencies,
    );
    expect(expiredUpload.status).toBe(403);

    clock = issuedAt;
    const restarted = create("another-local-object-storage-secret-01");
    const foreign = await handleLocalObjectDownload(new Request(download), segments, {
      ...dependencies,
      getStorage: () => restarted,
    });
    expect(foreign.status).toBe(403);
  });

  it("never echoes the key, the signature or a path in error bodies", async () => {
    const download = await storage.createDownloadUrl(key);
    const signature = new URL(download).searchParams.get("signature")!;
    const responses = [
      await handleLocalObjectDownload(new Request(tamper(download, "signature")), segments, {
        ...dependencies,
      }),
      await handleLocalObjectDownload(new Request(download), segments, dependencies),
      await handleLocalObjectDownload(new Request(download), ["..", "secret"], dependencies),
    ];
    for (const response of responses) {
      const text = await response.text();
      expect(text).not.toContain(key);
      expect(text).not.toContain("0f8fad5b");
      expect(text).not.toContain(signature);
      expect(text).not.toContain(rootDirectory);
      expect(text).not.toContain(secret);
    }
  });
});

describe("signed local download", () => {
  it("streams the object with private, sandboxed headers (Derivative served to the Studio)", async () => {
    const body = new Uint8Array([82, 73, 70, 70]);
    await storage.putObject({ body, contentType: "image/webp", key });
    const response = await handleLocalObjectDownload(
      new Request(await storage.createDownloadUrl(key)),
      segments,
      dependencies,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("content-length")).toBe("4");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(body);
  });

  it("answers 404 for a valid URL after the object was removed (Object removed)", async () => {
    await storage.putObject({ body: new Uint8Array([1]), contentType: "image/webp", key });
    const url = await storage.createDownloadUrl(key);
    await storage.deleteObject(key);
    const response = await handleLocalObjectDownload(new Request(url), segments, dependencies);
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("NOT_FOUND");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("local routes inactive outside local mode and method handling", () => {
  it("answers 404 for GET, HEAD and PUT without verifying when the driver is not local", async () => {
    const verifyRequest = vi.spyOn(storage, "verifyRequest");
    const inactive = { ...dependencies, getStorage: () => null };
    const url = await storage.createDownloadUrl(key);
    const upload = (await grant()).url;

    const get = await handleLocalObjectDownload(new Request(url), segments, inactive);
    expect(get.status).toBe(404);
    expect(await errorCode(get)).toBe("NOT_FOUND");
    const head = await handleLocalObjectDownload(
      new Request(url, { method: "HEAD" }),
      segments,
      inactive,
    );
    expect(head.status).toBe(404);
    expect(head.body).toBeNull();
    const putResponse = await handleLocalObjectUpload(
      put(upload, new Uint8Array([1])),
      segments,
      inactive,
    );
    expect(putResponse.status).toBe(404);
    expect(await errorCode(putResponse)).toBe("NOT_FOUND");
    expect(verifyRequest).not.toHaveBeenCalled();
    expect(await objectFiles()).toEqual([]);
  });

  it("answers HEAD with a download signature 403 without a body or a file read", async () => {
    await storage.putObject({ body: new Uint8Array([1]), contentType: "image/webp", key });
    const openObject = vi.spyOn(storage, "openObject");
    const response = await handleLocalObjectDownload(
      new Request(await storage.createDownloadUrl(key), { method: "HEAD" }),
      segments,
      dependencies,
    );
    expect(response.status).toBe(403);
    expect(response.body).toBeNull();
    expect(openObject).not.toHaveBeenCalled();
  });

  it("short-circuits HEAD even when a verifier would accept it", async () => {
    const openObject = vi.spyOn(storage, "openObject");
    const permissive: LocalObjectStorage = {
      ...storage,
      openObject,
      verifyRequest: () => ({ method: "GET", ok: true }),
    };
    const response = await handleLocalObjectDownload(
      new Request(`${origin}/api/local-object-storage/${key}`, { method: "HEAD" }),
      segments,
      { ...dependencies, getStorage: () => permissive },
    );
    expect(response.status).toBe(403);
    expect(response.body).toBeNull();
    expect(openObject).not.toHaveBeenCalled();
  });
});

describe("object key validation in the route", () => {
  it("answers 404 for traversal, separators and device names before verifying", async () => {
    const verifyRequest = vi.spyOn(storage, "verifyRequest");
    const url = await storage.createDownloadUrl(key);
    for (const path of [
      ["private", "assets", "..", "..", ".env"],
      ["private", "../../secret"],
      ["private", "a\\b"],
      ["private", "c:"],
      ["private", "nul"],
      ["private", "con.txt"],
      [],
    ]) {
      const response = await handleLocalObjectDownload(new Request(url), path, dependencies);
      expect(response.status).toBe(404);
      expect(await errorCode(response)).toBe("NOT_FOUND");
      const upload = await handleLocalObjectUpload(
        put(url, new Uint8Array([1])),
        path,
        dependencies,
      );
      expect(upload.status).toBe(404);
    }
    expect(verifyRequest).not.toHaveBeenCalled();
    expect(await readdir(rootDirectory)).toEqual([]);
  });
});

describe("failed upload logged safely", () => {
  it("logs only the request id, a fixed operation and the error name", async () => {
    const upload = await grant();
    const leakingError = Object.assign(
      new Error(`EACCES: permission denied, open '${join(rootDirectory, key)}' ${upload.url}`),
      { code: "EACCES" },
    );
    const failing: LocalObjectStorage = {
      ...storage,
      writeUpload: () => Promise.reject(leakingError),
    };
    const sink = { error: vi.fn() };
    const response = await handleLocalObjectUpload(put(upload.url, new Uint8Array([1])), segments, {
      getStorage: () => failing,
      reportFailure: (operation, error, requestId) =>
        reportOperationalFailure(operation, error, requestId, sink),
    });
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe("INTERNAL_ERROR");
    expect(sink.error).toHaveBeenCalledTimes(1);
    const [message, fields] = sink.error.mock.calls[0] as [string, Record<string, unknown>];
    expect(Object.keys(fields).sort()).toEqual(["errorName", "operation", "requestId"]);
    expect(fields["errorName"]).toBe("Error");
    expect(fields["requestId"]).toBe(response.headers.get("x-request-id"));
    const logged = JSON.stringify([message, fields]);
    const signature = new URL(upload.url).searchParams.get("signature")!;
    for (const secretValue of [key, signature, rootDirectory, upload.url, "0f8fad5b"]) {
      expect(logged).not.toContain(secretValue);
    }
  });

  it("reports an unexpected download failure without a path", async () => {
    await storage.putObject({ body: new Uint8Array([1]), contentType: "image/webp", key });
    const failing: LocalObjectStorage = {
      ...storage,
      openObject: () => Promise.reject(new Error(join(rootDirectory, key))),
    };
    const response = await handleLocalObjectDownload(
      new Request(await storage.createDownloadUrl(key)),
      segments,
      { ...dependencies, getStorage: () => failing },
    );
    expect(response.status).toBe(500);
    expect(dependencies.reportFailure).toHaveBeenCalledWith(
      "local_object_storage_download_failed",
      expect.any(Error),
      response.headers.get("x-request-id"),
    );
  });
});
