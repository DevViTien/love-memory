import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertTemplateBuildWithinBudget,
  parseTemplateManifest,
  parseTemplatePayload,
} from "@love-memory/template-sdk";
import { describe, expect, it } from "vitest";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const templatesRoot = join(repositoryRoot, "templates");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
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
      expect(() => parseTemplatePayload(manifest, readJson(fixturePath))).not.toThrow();
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
