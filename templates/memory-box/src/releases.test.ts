// @vitest-environment node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  assertTemplateBuildWithinBudget,
  parseTemplateManifest,
  parseTemplatePayload,
} from "@love-memory/template-sdk";
import { describe, expect, it } from "vitest";

import templateManifest from "../template.manifest.json";
import sourcePreviewFixture from "../preview.fixture.json";
import { computeContentHash } from "../scripts/artifact-checks.mjs";
import { MEMORY_BOX_RELEASES } from "./index";

/**
 * SHA-256 of the exact bytes of every committed release file, recorded when the version was
 * released. Released files never change: a different hash means a release file was edited, so ship
 * a new version instead of updating these values. `.gitattributes` forces LF, so the bytes are the
 * same on every platform.
 */
const RELEASED_FILE_HASHES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "1.1.0": {
    "artifact.json": "5969740e5d4427496a8ac177d8925c0f69cf03a63ae7cd287fad13b83532f04e",
    "build-metrics.json": "b97eb1d0cf30b8bf34b2f8252b0e1166210eec580da7b74992464b3e34c66e04",
    "index.html": "41b4550b0560ad14b25d0cf3f9ce7b9a778ca733a54dde86b0ab560d67f89cb3",
    "manifest.json": "0ba46974c869b894d1f458d1d55092fbf4808b1bdc96852f48fdd4370fb691ee",
    "preview.fixture.json": "6d082f1e13d750c8c47885e2c15db1825b25c9c6e2fdb26f6e378ac3fae165b4",
    "release.json": "8edaee688c45c780e7809685c04593b4b77b6ce42b511c7bf3dc643773a8d342",
    "runtime.mjs": "ce23a41bfc5b2dcc15da50cbae746ba6ab904d31a97436a3e826e8598d1d11aa",
  },
};

function releasePath(version: string, name = ""): string {
  return fileURLToPath(new URL(`../releases/${version}/${name}`, import.meta.url));
}

function releaseFile(version: string, name: string): string {
  return readFileSync(releasePath(version, name), "utf8");
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("committed release file pins", () => {
  it("pins every committed release and no other", () => {
    expect(MEMORY_BOX_RELEASES.map((release) => release.version)).toEqual(
      Object.keys(RELEASED_FILE_HASHES),
    );
    const releasesDir = fileURLToPath(new URL("../releases/", import.meta.url));
    expect(readdirSync(releasesDir).sort()).toEqual(Object.keys(RELEASED_FILE_HASHES).sort());
  });
});

describe.each(MEMORY_BOX_RELEASES.map((release) => [release.version, release] as const))(
  "committed release %s",
  (version, release) => {
    it("contains exactly the pinned files, each byte-identical to its release", () => {
      const pinned = RELEASED_FILE_HASHES[version] ?? {};

      expect(readdirSync(releasePath(version)).sort()).toEqual(Object.keys(pinned).sort());
      for (const [name, hash] of Object.entries(pinned)) {
        expect(sha256(readFileSync(releasePath(version, name))), name).toBe(hash);
      }
    });

    it("keeps manifest.json and preview.fixture.json equal to the source while versions match", () => {
      if (templateManifest.version !== version) return;
      expect(JSON.parse(releaseFile(version, "manifest.json"))).toEqual(templateManifest);
      expect(release.manifest).toEqual(templateManifest);
      expect(release.previewFixture).toEqual(sourcePreviewFixture);
    });

    it("stores the served files byte-equal to release.json", () => {
      expect(release.files["index.html"]).toBe(releaseFile(version, "index.html"));
      expect(release.files["runtime.mjs"]).toBe(releaseFile(version, "runtime.mjs"));
    });

    it("has the content hash recorded in artifact.json", () => {
      expect(computeContentHash(release.files["index.html"], release.files["runtime.mjs"])).toBe(
        release.artifact.contentHash,
      );
    });

    it("is within its manifest budgets and ships a valid preview fixture", () => {
      const manifest = parseTemplateManifest(release.manifest);

      expect(manifest).toMatchObject({ id: "memory-box", version });
      expect(() => assertTemplateBuildWithinBudget(manifest, release.buildMetrics)).not.toThrow();
      expect(() => parseTemplatePayload(manifest, release.previewFixture)).not.toThrow();
    });

    it("references only its own runtime module", () => {
      expect(release.files["index.html"]).toContain('<script type="module" src="runtime.mjs">');
      expect(release.files["runtime.mjs"]).not.toMatch(/\bimport\s*[({"'`*]/);
    });
  },
);
