import type { TemplateMessagePayload } from "@love-memory/template-sdk";

import artifact_1_1_0 from "../releases/1.1.0/artifact.json";
import buildMetrics_1_1_0 from "../releases/1.1.0/build-metrics.json";
import manifest_1_1_0 from "../releases/1.1.0/manifest.json";
import previewFixture_1_1_0 from "../releases/1.1.0/preview.fixture.json";
import files_1_1_0 from "../releases/1.1.0/release.json";

export type MemoryBoxReleaseFiles = Readonly<{ "index.html": string; "runtime.mjs": string }>;

/**
 * A committed, immutable release read from `releases/<version>/`. The web registry serves only
 * these files, never the source build in `dist/`.
 */
export type MemoryBoxRelease = Readonly<{
  artifact: Readonly<{ contentHash: string }>;
  buildMetrics: unknown;
  files: MemoryBoxReleaseFiles;
  manifest: Readonly<Record<string, unknown>>;
  previewFixture: Readonly<Record<string, unknown>>;
  version: string;
}>;

export type MemoryBoxHarnessFixture = Readonly<{
  assets: Readonly<Record<string, string>>;
  payload: TemplateMessagePayload;
}>;

export const MEMORY_BOX_RELEASES: readonly MemoryBoxRelease[] = Object.freeze([
  {
    artifact: artifact_1_1_0,
    buildMetrics: buildMetrics_1_1_0,
    files: files_1_1_0,
    manifest: manifest_1_1_0,
    previewFixture: previewFixture_1_1_0,
    version: "1.1.0",
  },
]);

export { MEMORY_BOX_HARNESS_FIXTURES } from "./fixtures";
