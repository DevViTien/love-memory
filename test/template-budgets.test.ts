import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createLicensedAudioCatalog,
  type LicensedAudioCatalog,
  licensedAudioCatalog,
} from "@love-memory/domain";
import {
  assertTemplateBuildWithinBudget,
  parseTemplateManifest,
  parseTemplatePayload,
  type TemplateManifest,
} from "@love-memory/template-sdk";
import { describe, expect, it } from "vitest";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const templatesRoot = join(repositoryRoot, "templates");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

/** Fixture `audio` values that do not name a track of the licensed audio catalog. */
function findUnknownFixtureTracks(
  manifest: TemplateManifest,
  fixture: Readonly<Record<string, unknown>>,
  catalog: LicensedAudioCatalog,
): string[] {
  return manifest.fields.flatMap((field) => {
    const value = fixture[field.id];
    return field.type === "audio" && typeof value === "string" && !catalog.find(value)
      ? [`${manifest.id}: preview fixture uses unknown audio track ${value}`]
      : [];
  });
}

describe("built template artifacts", () => {
  it("provides a valid manifest and measured output within budget", () => {
    expect(existsSync(templatesRoot)).toBe(true);

    const templateDirectories = readdirSync(templatesRoot, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory(),
    );

    for (const directory of templateDirectories) {
      const templateRoot = join(templatesRoot, directory.name);
      const manifestPath = join(templateRoot, "template.manifest.json");
      const metricsPath = join(templateRoot, "dist", "build-metrics.json");
      const artifactPath = join(templateRoot, "dist", "artifact.json");
      const builtManifestPath = join(templateRoot, "dist", "manifest.json");

      expect(existsSync(manifestPath), `${directory.name} is missing its manifest`).toBe(true);
      expect(existsSync(metricsPath), `${directory.name} is missing measured build metrics`).toBe(
        true,
      );
      expect(existsSync(artifactPath), `${directory.name} is missing artifact metadata`).toBe(true);
      expect(existsSync(builtManifestPath), `${directory.name} is missing built manifest`).toBe(
        true,
      );

      const manifest = parseTemplateManifest(readJson(manifestPath));
      const fixturePath = join(templateRoot, "dist", manifest.previewFixture);
      expect(manifest.id).toBe(directory.name);
      expect(existsSync(join(templateRoot, "dist", manifest.entry))).toBe(true);
      expect(existsSync(fixturePath)).toBe(true);
      const fixture = parseTemplatePayload(manifest, readJson(fixturePath));
      expect(findUnknownFixtureTracks(manifest, fixture, licensedAudioCatalog)).toEqual([]);
      expect(() => assertTemplateBuildWithinBudget(manifest, readJson(metricsPath))).not.toThrow();
      const metadata = readJson(artifactPath);
      expect(typeof metadata === "object" && metadata !== null).toBe(true);
      const values = metadata as Readonly<Record<string, unknown>>;
      expect(values["contentHash"]).toMatch(/^[a-f0-9]{64}$/);
      expect(values["id"]).toBe(manifest.id);
      expect(values["version"]).toBe(manifest.version);
      expect(readJson(builtManifestPath)).toEqual(readJson(manifestPath));
    }
  });
});

describe("findUnknownFixtureTracks", () => {
  const manifest = parseTemplateManifest({
    budgets: { initialJsKbGzip: 20, initialMediaKb: 100, maxTextureMb: 16 },
    capabilities: ["audio", "dom"],
    engineVersion: "1.0.0",
    entry: "index.html",
    fields: [{ id: "audio", label: "Nhạc", source: "licensedLibrary", type: "audio" }],
    id: "audio-fixture",
    meta: {
      description: "Audio fixture",
      estimatedDurationSec: 10,
      moods: ["warm"],
      name: "Audio",
      occasions: ["anniversary"],
    },
    previewFixture: "fixture.json",
    status: "draft",
    version: "1.0.0",
  });

  it("names the template and the unknown track id", () => {
    expect(
      findUnknownFixtureTracks(
        manifest,
        { audio: "missing-track" },
        createLicensedAudioCatalog([]),
      ),
    ).toEqual(["audio-fixture: preview fixture uses unknown audio track missing-track"]);
  });

  it("accepts fixtures without audio", () => {
    expect(findUnknownFixtureTracks(manifest, {}, createLicensedAudioCatalog([]))).toEqual([]);
  });
});
