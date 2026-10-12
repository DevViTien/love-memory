import { createHash } from "node:crypto";

import { ObjectNotFoundError } from "@love-memory/storage";

import { getTemplateArtifact } from "@/modules/templates/infrastructure/template-artifact-registry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const kills = vi.hoisted(() => ({ isKilled: vi.fn((_id: string, _version: string) => false) }));
const html = vi.hoisted(() => ({ findArtifact: vi.fn() }));
const storage = vi.hoisted(() => ({ getObject: vi.fn() }));

vi.mock("@/modules/templates/infrastructure/mongo-html-template-repository", () => ({
  mongoHtmlTemplateRepository: { findArtifact: html.findArtifact },
}));

vi.mock("@/composition/storage", () => ({ createStorage: () => storage }));

vi.mock("@/modules/templates/infrastructure/mongo-template-version-state", () => ({
  mongoTemplateVersionState: {
    isKilled: (id: string, version: string) => Promise.resolve(kills.isKilled(id, version)),
  },
}));

import { GET } from "./route";

const font = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3]);
const fontSha256 = createHash("sha256").update(font).digest("hex");
const htmlHash = "b".repeat(64);
const loveDays = {
  artifactContentHash: htmlHash,
  files: [
    {
      contentType: "font/woff2",
      name: "assets/fonts/hand.woff2",
      sha256: fontSha256,
      sizeBytes: font.byteLength,
      storageKey: `private/templates/love-days/1.0.0/${htmlHash}/assets/fonts/hand.woff2`,
    },
  ],
};

beforeEach(() => {
  html.findArtifact.mockReset();
  html.findArtifact.mockImplementation((id: string) =>
    Promise.resolve(id === "love-days" ? loveDays : null),
  );
  storage.getObject.mockReset();
  storage.getObject.mockResolvedValue(font);
});

const hash = getTemplateArtifact("memory-box-spike", "0.1.0")!.contentHash;

describe("content-addressed template artifact route", () => {
  it("serves immutable HTML and ESM with isolation headers", async () => {
    const context = (fileName: string) => ({
      params: Promise.resolve({
        contentHash: hash,
        filePath: fileName.split("/"),
        templateId: "memory-box-spike",
        version: "0.1.0",
      }),
    });
    const html = await GET(new Request("https://example.test"), context("index.html"));
    const runtime = await GET(new Request("https://example.test"), context("runtime.mjs"));
    expect(html.status).toBe(200);
    expect(html.headers.get("cache-control")).toContain("immutable");
    expect(html.headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(html.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);
    expect(runtime.headers.get("content-type")).toContain("javascript");
    expect(runtime.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers 404 for a killed version and serves it again after a restore (Killed version)", async () => {
    const artifact = getTemplateArtifact("memory-box", "1.1.0")!;
    const request = () =>
      GET(new Request("https://example.test"), {
        params: Promise.resolve({
          contentHash: artifact.contentHash,
          filePath: ["index.html"],
          templateId: "memory-box",
          version: "1.1.0",
        }),
      });
    kills.isKilled.mockReturnValueOnce(true);
    const killed = await request();
    expect(killed.status).toBe(404);
    expect(await killed.text()).toBe("");
    expect(kills.isKilled).toHaveBeenCalledWith("memory-box", "1.1.0");

    const restored = await request();
    expect(restored.status).toBe(200);
  });

  it("serves the committed memory-box 1.1.0 release with the template CSP", async () => {
    const artifact = getTemplateArtifact("memory-box", "1.1.0")!;
    const request = (fileName: string) =>
      GET(new Request("https://example.test"), {
        params: Promise.resolve({
          contentHash: artifact.contentHash,
          filePath: fileName.split("/"),
          templateId: "memory-box",
          version: "1.1.0",
        }),
      });
    const html = await request("index.html");
    const runtime = await request("runtime.mjs");

    expect(html.status).toBe(200);
    expect(await html.text()).toBe(artifact.files["index.html"]?.body);
    expect(html.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(html.headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(html.headers.get("content-security-policy")).toContain("media-src 'none'");
    expect(runtime.status).toBe(200);
    expect(runtime.headers.get("content-type")).toContain("javascript");
    expect(await runtime.text()).toBe(artifact.files["runtime.mjs"]?.body);
  });

  describe("local object storage mode", () => {
    const request = () =>
      GET(new Request("https://example.test"), {
        params: Promise.resolve({
          contentHash: hash,
          filePath: ["index.html"],
          templateId: "memory-box-spike",
          version: "0.1.0",
        }),
      });

    beforeEach(() => {
      vi.stubEnv("STORAGE_DRIVER", "local");
      vi.stubEnv("APP_URL", "http://127.0.0.1:3100");
      vi.stubEnv("LOCAL_OBJECT_STORAGE_SECRET", "artifact-local-object-storage-secret-01");
      vi.stubEnv("VERCEL_ENV", "");
    });

    afterEach(() => vi.unstubAllEnvs());

    it("keeps immutable caching with the Blob driver (Cache and integrity headers)", async () => {
      vi.stubEnv("STORAGE_DRIVER", "");
      const response = await request();
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(response.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("content-security-policy")).not.toContain(
        "/api/local-object-storage/",
      );
    });

    it("is not cached in local storage mode (Local storage mode is not cached)", async () => {
      const response = await request();
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    });

    it("may show locally stored images (Artifact may show locally stored images)", async () => {
      const policy = (await request()).headers.get("content-security-policy") ?? "";
      expect(policy).toContain(
        "img-src data: http://127.0.0.1:3100/template-artifacts/ https://*.private.blob.vercel-storage.com http://127.0.0.1:3100/api/local-object-storage/;",
      );
      expect(policy).toContain("connect-src 'none'");
    });

    it("keeps immutable caching when the local driver is refused", async () => {
      vi.stubEnv("VERCEL_ENV", "production");
      const response = await request();
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(response.headers.get("content-security-policy")).not.toContain(
        "/api/local-object-storage/",
      );
    });
  });

  it("rejects a stale hash, missing file or unknown version", async () => {
    for (const params of [
      {
        contentHash: "0".repeat(64),
        filePath: ["index.html"],
        templateId: "memory-box-spike",
        version: "0.1.0",
      },
      {
        contentHash: hash,
        filePath: ["private.txt"],
        templateId: "memory-box-spike",
        version: "0.1.0",
      },
      {
        contentHash: hash,
        filePath: ["index.html"],
        templateId: "memory-box-spike",
        version: "9.9.9",
      },
    ]) {
      const response = await GET(new Request("https://example.test"), {
        params: Promise.resolve(params),
      });
      expect(response.status).toBe(404);
    }
  });

  describe("html template versions (HTML artifact files from storage)", () => {
    const request = (filePath: string[], contentHash = htmlHash) =>
      GET(new Request("https://example.test"), {
        params: Promise.resolve({
          contentHash,
          filePath,
          templateId: "love-days",
          version: "1.0.0",
        }),
      });

    it("serves a stored file under assets/ with its content type and the template headers", async () => {
      const response = await request(["assets", "fonts", "hand.woff2"]);

      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(font);
      expect(response.headers.get("content-type")).toBe("font/woff2");
      expect(response.headers.get("etag")).toBe(`"${fontSha256}"`);
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      const policy = response.headers.get("content-security-policy") ?? "";
      expect(policy).toContain("font-src https://example.test/template-artifacts/;");
      expect(policy).toContain("sandbox allow-scripts");
      expect(storage.getObject).toHaveBeenCalledWith(
        loveDays.files[0]?.storageKey,
        2 * 1024 * 1024,
      );
    });

    it("answers 404 for a stale hash, an unknown file or bytes that no longer match", async () => {
      expect((await request(["assets", "fonts", "hand.woff2"], "0".repeat(64))).status).toBe(404);
      expect((await request(["assets", "missing.png"])).status).toBe(404);
      storage.getObject.mockResolvedValueOnce(new Uint8Array([1]));
      const tampered = await request(["assets", "fonts", "hand.woff2"]);
      expect(tampered.status).toBe(404);
      expect(await tampered.text()).toBe("");
      storage.getObject.mockRejectedValueOnce(new ObjectNotFoundError("missing"));
      const missing = await request(["assets", "fonts", "hand.woff2"]);
      expect(missing.status).toBe(404);
      expect(await missing.text()).toBe("");
    });

    it("answers 404 for an unsafe path without reading anything", async () => {
      for (const filePath of [
        [],
        ["..", "secret"],
        ["assets", ".."],
        ["assets", "a%2Fb"],
        ["assets", "a\b"],
        [".hidden"],
        ["a", "b", "c", "d", "e", "f", "g"],
      ]) {
        expect((await request(filePath)).status).toBe(404);
      }
      expect(html.findArtifact).not.toHaveBeenCalled();
    });
  });
});
