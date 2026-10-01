// @vitest-environment node
import { MEMORY_BOX_HARNESS_FIXTURES, MEMORY_BOX_RELEASES } from "@love-memory/template-memory-box";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { seedTemplateVersionManifests } from "./seed-template-catalog";
import { getTemplateArtifact, getTemplateFixture } from "./template-artifact-registry";

/**
 * `contentHash` of every committed template release, recorded when the version was released.
 * Released bytes never change: a different hash means a release file was edited, so ship a new
 * version instead of updating this value.
 */
const RELEASED_CONTENT_HASHES: Readonly<Record<string, string>> = {
  "memory-box@1.1.0": "d4bbee2c74e2d5bae14a1d073232409db0d9b8b52d5c6767d7d207fdfb134b07",
};

const MEMORY_BOX_RELEASES_DIR = new URL(
  "../../../../../../templates/memory-box/releases/",
  import.meta.url,
);

function committedReleaseFile(version: string, name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`${version}/${name}`, MEMORY_BOX_RELEASES_DIR)),
    "utf8",
  );
}

describe("template artifact registry", () => {
  it("returns one immutable exact-version artifact with a content hash", () => {
    const artifact = getTemplateArtifact("memory-box-spike", "0.1.0");
    expect(artifact).toMatchObject({ id: "memory-box-spike", version: "0.1.0" });
    expect(artifact?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact?.files["index.html"]?.body).toContain("sandbox runtime");
    expect(artifact?.files["runtime.mjs"]?.contentType).toContain("javascript");
    expect(getTemplateArtifact("memory-box-spike", "0.2.0")).toBeNull();
    expect(getTemplateFixture("memory-box-spike", "0.1.0", "max-length")).toMatchObject({
      assets: {},
      payload: { theme: "warm-paper" },
    });
    expect(getTemplateFixture("memory-box-spike", "0.1.0", "unknown")).toBeNull();
  });

  it("resolves memory-box 1.1.0 by exact version only", () => {
    expect(getTemplateArtifact("memory-box", "1.1.0")).toMatchObject({
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
      id: "memory-box",
      version: "1.1.0",
    });
    expect(getTemplateArtifact("memory-box", "1.0.0")).toBeNull();
    expect(getTemplateArtifact("memory-box", "1.1")).toBeNull();
  });

  it("serves every committed release unchanged with its recorded hash", () => {
    expect(MEMORY_BOX_RELEASES.map((release) => `memory-box@${release.version}`)).toEqual(
      Object.keys(RELEASED_CONTENT_HASHES),
    );

    for (const release of MEMORY_BOX_RELEASES) {
      const artifact = getTemplateArtifact("memory-box", release.version);
      const document = committedReleaseFile(release.version, "index.html");
      const runtime = committedReleaseFile(release.version, "runtime.mjs");
      const artifactJson = JSON.parse(committedReleaseFile(release.version, "artifact.json")) as {
        contentHash: string;
      };

      expect(artifact?.files["index.html"]?.body).toBe(document);
      expect(artifact?.files["runtime.mjs"]?.body).toBe(runtime);
      expect(artifact?.contentHash).toBe(artifactJson.contentHash);
      expect(artifact?.contentHash).toBe(RELEASED_CONTENT_HASHES[`memory-box@${release.version}`]);
    }
  });

  it("carries asset URLs in the memory-box harness fixtures of each release", () => {
    for (const release of MEMORY_BOX_RELEASES) {
      expect(getTemplateArtifact("memory-box", release.version)?.fixtures).toBe(
        MEMORY_BOX_HARNESS_FIXTURES[release.version],
      );
    }
    expect(Object.keys(getTemplateArtifact("memory-box", "1.1.0")?.fixtures ?? {})).toEqual([
      "default",
      "max-length",
      "missing-fields",
      "broken-image",
    ]);
    const fixture = getTemplateFixture("memory-box", "1.1.0", "default");
    expect(Object.keys(fixture?.assets ?? {})).toHaveLength(5);
    expect(Object.values(fixture?.assets ?? {}).every((url) => url.startsWith("data:image/"))).toBe(
      true,
    );
  });

  it("registers an artifact only for the seeded versions that can be published", () => {
    const registered = seedTemplateVersionManifests
      .map((manifest) => `${manifest.id}@${manifest.version}`)
      .filter((identity) => {
        const [id = "", version = ""] = identity.split("@");
        return getTemplateArtifact(id, version) !== null;
      });
    // Placeholder versions of templates 2-3 and the retired 1.0.0 are shown as "Sắp ra mắt".
    expect(registered).toEqual(["memory-box@1.1.0"]);
  });
});
