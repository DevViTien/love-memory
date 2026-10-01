import { getTemplateArtifact } from "@/modules/templates/infrastructure/template-artifact-registry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const hash = getTemplateArtifact("memory-box-spike", "0.1.0")!.contentHash;

describe("content-addressed template artifact route", () => {
  it("serves immutable HTML and ESM with isolation headers", async () => {
    const context = (fileName: string) => ({
      params: Promise.resolve({
        contentHash: hash,
        fileName,
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

  it("serves the committed memory-box 1.1.0 release with the template CSP", async () => {
    const artifact = getTemplateArtifact("memory-box", "1.1.0")!;
    const request = (fileName: string) =>
      GET(new Request("https://example.test"), {
        params: Promise.resolve({
          contentHash: artifact.contentHash,
          fileName,
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
          fileName: "index.html",
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
      expect(response.headers.get("content-security-policy")).not.toContain("127.0.0.1");
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
        "img-src data: https://*.private.blob.vercel-storage.com http://127.0.0.1:3100/api/local-object-storage/;",
      );
      expect(policy).toContain("connect-src 'none'");
    });

    it("keeps immutable caching when the local driver is refused", async () => {
      vi.stubEnv("VERCEL_ENV", "production");
      const response = await request();
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(response.headers.get("content-security-policy")).not.toContain("127.0.0.1");
    });
  });

  it("rejects a stale hash, missing file or unknown version", async () => {
    for (const params of [
      {
        contentHash: "0".repeat(64),
        fileName: "index.html",
        templateId: "memory-box-spike",
        version: "0.1.0",
      },
      {
        contentHash: hash,
        fileName: "private.txt",
        templateId: "memory-box-spike",
        version: "0.1.0",
      },
      {
        contentHash: hash,
        fileName: "index.html",
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
});
