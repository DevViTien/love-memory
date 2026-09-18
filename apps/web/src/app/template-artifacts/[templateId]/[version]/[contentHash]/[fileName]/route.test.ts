import { getTemplateArtifact } from "@/modules/templates/infrastructure/template-artifact-registry";
import { describe, expect, it } from "vitest";

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
