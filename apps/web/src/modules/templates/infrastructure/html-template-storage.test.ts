import { createHash } from "node:crypto";

import { ObjectNotFoundError } from "@love-memory/storage";
import { describe, expect, it, vi } from "vitest";

import { createHtmlTemplateArtifactSource } from "./html-template-artifacts";
import { createStorageHtmlTemplateFiles } from "./storage-html-template-files";

const body = new TextEncoder().encode("<!doctype html>");
const sha256 = createHash("sha256").update(body).digest("hex");
const hash = "a".repeat(64);
const record = {
  artifactContentHash: hash,
  files: [
    {
      contentType: "text/html; charset=utf-8",
      name: "index.html",
      sha256,
      sizeBytes: body.byteLength,
      storageKey: `private/templates/love-days/1.0.0/${hash}/index.html`,
    },
  ],
};

describe("html template artifact source", () => {
  it("serves a stored file whose bytes match its recorded hash", async () => {
    const getObject = vi.fn(() => Promise.resolve(body));
    const source = createHtmlTemplateArtifactSource({
      findArtifact: () => Promise.resolve(record),
      storage: () => ({ getObject }),
    });

    const artifact = await source.find("love-days", "1.0.0");

    expect(artifact).toMatchObject({
      contentHash: hash,
      id: "love-days",
      kind: "html",
      version: "1.0.0",
    });
    await expect(artifact?.readFile("index.html")).resolves.toEqual({
      body,
      contentType: "text/html; charset=utf-8",
    });
    expect(getObject).toHaveBeenCalledWith(record.files[0]?.storageKey, 2 * 1024 * 1024);
    await expect(artifact?.readFile("private.txt")).resolves.toBeNull();
  });

  it("refuses bytes that no longer match the recorded hash", async () => {
    const source = createHtmlTemplateArtifactSource({
      findArtifact: () => Promise.resolve(record),
      storage: () => ({ getObject: () => Promise.resolve(new TextEncoder().encode("tampered")) }),
    });

    await expect((await source.find("love-days", "1.0.0"))?.readFile("index.html")).resolves.toBe(
      null,
    );
  });

  it("answers no file when its object is missing from storage, and fails on other errors", async () => {
    const getObject = vi
      .fn()
      .mockRejectedValueOnce(new ObjectNotFoundError("missing"))
      .mockRejectedValueOnce(new Error("offline"));
    const artifact = await createHtmlTemplateArtifactSource({
      findArtifact: () => Promise.resolve(record),
      storage: () => ({ getObject }),
    }).find("love-days", "1.0.0");

    await expect(artifact?.readFile("index.html")).resolves.toBeNull();
    await expect(artifact?.readFile("index.html")).rejects.toThrow("offline");
  });

  it("finds nothing for a version without a stored html artifact", async () => {
    const storage = vi.fn();
    const source = createHtmlTemplateArtifactSource({
      findArtifact: () => Promise.resolve(null),
      storage,
    });

    await expect(source.find("memory-box", "1.0.0")).resolves.toBeNull();
    expect(storage).not.toHaveBeenCalled();
  });
});

describe("storage html template files", () => {
  function store(existing: Uint8Array | null | Error) {
    return {
      getObject: vi.fn(() =>
        existing !== null && !(existing instanceof Error)
          ? Promise.resolve(existing)
          : Promise.reject(new Error("no")),
      ),
      getObjectMetadata: vi.fn(() =>
        existing instanceof Error
          ? Promise.reject(existing)
          : existing
            ? Promise.resolve({ contentLength: existing.byteLength, contentType: "text/html" })
            : Promise.reject(new ObjectNotFoundError("missing")),
      ),
      putObject: vi.fn(() => Promise.resolve()),
    };
  }

  it("writes a missing file with a long cache lifetime", async () => {
    const storage = store(null);

    await createStorageHtmlTemplateFiles(storage).putFile("private/templates/x", body, "text/html");

    expect(storage.putObject).toHaveBeenCalledWith({
      allowOverwrite: false,
      body,
      cacheControlMaxAge: 31536000,
      contentType: "text/html",
      key: "private/templates/x",
    });
  });

  it("keeps a file that already exists with the same bytes", async () => {
    const storage = store(body);

    await createStorageHtmlTemplateFiles(storage).putFile("private/templates/x", body, "text/html");

    expect(storage.getObject).toHaveBeenCalledWith("private/templates/x", 2 * 1024 * 1024);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it.each([
    ["another size", new TextEncoder().encode("<!doctype")],
    ["other bytes of the same size", new TextEncoder().encode("<!DOCTYPE html>")],
  ])("rewrites an existing object with %s", async (_, existing) => {
    const storage = store(existing);

    await createStorageHtmlTemplateFiles(storage).putFile("private/templates/x", body, "text/html");

    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({ allowOverwrite: true, body, key: "private/templates/x" }),
    );
  });

  it("fails on any other storage error", async () => {
    const storage = store(new Error("offline"));

    await expect(
      createStorageHtmlTemplateFiles(storage).putFile("private/templates/x", body, "text/html"),
    ).rejects.toThrow("offline");
    expect(storage.putObject).not.toHaveBeenCalled();
  });
});
