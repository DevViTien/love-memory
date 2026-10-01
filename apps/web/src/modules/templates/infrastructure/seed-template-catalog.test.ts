import { MEMORY_BOX_RELEASES } from "@love-memory/template-memory-box";
import { parseTemplateManifest } from "@love-memory/template-sdk";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  assertSeedTemplateReleases,
  seedTemplateCatalog,
  seedTemplateCurrentManifests,
  seedTemplateReleases,
  seedTemplateVersionManifests,
} from "./seed-template-catalog";
import { canonicalJson, manifestContentHash } from "./template-release-seed";

/** Canonical manifest hashes of the releases seeded before `memory-box@1.1.0`. */
const PRE_CHANGE_CANONICAL_HASHES = {
  "memory-box@1.0.0": "72cb6a6838b17736fcdfe7dae23a2028c8b35188bec88ce234e2396fca9883d1",
  "midnight-wish@1.0.0": "fe21c7399d9b505077de27d74653f6bcca8f7237fa0e292f0ddf06924dff0c35",
  "our-timeline@1.0.0": "980ad4b371e772a7fdedece9224d59c5172477262f01176995da6a2eb0b4c7c1",
};

function seedVersion(templateId: string, version: string) {
  const entry = seedTemplateReleases
    .find((release) => release.templateId === templateId)
    ?.versions.find((candidate) => candidate.manifest["version"] === version);
  if (!entry) throw new Error(`Missing seed version ${templateId}@${version}`);
  return entry;
}

describe("seed template catalog", () => {
  it("contains only validated published template summaries", async () => {
    const templates = await seedTemplateCatalog.listPublished();

    expect(templates.map((template) => [template.id, template.version])).toEqual([
      ["memory-box", "1.1.0"],
      ["our-timeline", "1.0.0"],
      ["midnight-wish", "1.0.0"],
    ]);
    await expect(seedTemplateCatalog.findPublishedById("memory-box")).resolves.toMatchObject({
      imageRequirement: {
        maxItems: 8,
        minItems: 3,
      },
      version: "1.1.0",
    });
  });

  it("does not expose a mutable catalog array", async () => {
    expect(Object.isFrozen(await seedTemplateCatalog.listPublished())).toBe(true);
  });

  it("keeps memory-box 1.0.0 retired and byte-for-byte as first stored", () => {
    const retired = seedVersion("memory-box", "1.0.0");

    expect(retired.status).toBe("retired");
    expect(retired.manifest["status"]).toBe("published");
    expect(manifestContentHash(retired.manifest)).toBe(
      PRE_CHANGE_CANONICAL_HASHES["memory-box@1.0.0"],
    );
    // The hash the pre-change seed stored: sha256 of the serialized parsed manifest.
    expect(
      createHash("sha256")
        .update(JSON.stringify(parseTemplateManifest(retired.manifest)))
        .digest("hex"),
    ).toBe("3bcda99c59f72576cee4528aa166baa08b900953e82d749e5b8d67a21f29825f");
    expect(manifestContentHash(seedVersion("our-timeline", "1.0.0").manifest)).toBe(
      PRE_CHANGE_CANONICAL_HASHES["our-timeline@1.0.0"],
    );
    expect(manifestContentHash(seedVersion("midnight-wish", "1.0.0").manifest)).toBe(
      PRE_CHANGE_CANONICAL_HASHES["midnight-wish@1.0.0"],
    );
  });

  it("seeds memory-box 1.1.0 from the committed release", () => {
    const current = seedVersion("memory-box", "1.1.0");
    const release = MEMORY_BOX_RELEASES.find((candidate) => candidate.version === "1.1.0");

    expect(current.status).toBe("published");
    expect(current.manifest).toBe(release?.manifest);
    expect(current.previewFixture).toBe(release?.previewFixture);
  });

  it("stores raw manifests without hidden parser defaults", () => {
    for (const release of seedTemplateReleases) {
      for (const version of release.versions) {
        expect(canonicalJson(parseTemplateManifest(version.manifest))).toBe(
          canonicalJson(version.manifest),
        );
      }
    }
    expect(seedTemplateCurrentManifests.map((manifest) => manifest.version)).toEqual([
      "1.1.0",
      "1.0.0",
      "1.0.0",
    ]);
    expect(seedTemplateVersionManifests).toHaveLength(4);
  });

  it("rejects releases that rely on defaults, belong elsewhere or lack a published current version", () => {
    const memoryBox = seedTemplateReleases[0]!;
    const legacy = seedVersion("memory-box", "1.0.0");
    const fields = legacy.manifest["fields"] as ReadonlyArray<Record<string, unknown>>;
    const withDefaults = {
      ...legacy,
      manifest: {
        ...legacy.manifest,
        fields: fields.map((field) =>
          Object.fromEntries(Object.entries(field).filter(([key]) => key !== "required")),
        ),
      },
    };

    expect(() => assertSeedTemplateReleases([{ ...memoryBox, versions: [withDefaults] }])).toThrow(
      "memory-box@1.0.0 relies on parser defaults",
    );
    expect(() =>
      assertSeedTemplateReleases([{ ...memoryBox, templateId: "our-timeline" }]),
    ).toThrow("declares template memory-box");
    expect(() => assertSeedTemplateReleases([{ ...memoryBox, currentVersion: "1.0.0" }])).toThrow(
      "current version 1.0.0 is not published",
    );
  });
});
