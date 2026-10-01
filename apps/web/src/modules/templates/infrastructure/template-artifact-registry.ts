import { MEMORY_BOX_HARNESS_FIXTURES, MEMORY_BOX_RELEASES } from "@love-memory/template-memory-box";
import {
  MEMORY_BOX_SPIKE_DOCUMENT,
  MEMORY_BOX_SPIKE_FIXTURES,
  MEMORY_BOX_SPIKE_RUNTIME,
} from "@love-memory/template-memory-box-spike";
import type { TemplateMessagePayload } from "@love-memory/template-sdk";
import { createHash } from "node:crypto";

/** A Viewer harness fixture: the `INIT` payload and the asset URLs sent as `INIT` `assets`. */
export type TemplateFixture = Readonly<{
  assets: Readonly<Record<string, string>>;
  payload: TemplateMessagePayload;
}>;

export type TemplateArtifact = Readonly<{
  contentHash: string;
  files: Readonly<Record<string, Readonly<{ body: string; contentType: string }>>>;
  fixtures: Readonly<Record<string, TemplateFixture>>;
  id: string;
  version: string;
}>;

function computeContentHash(document: string, runtime: string): string {
  return createHash("sha256").update(document).update("\0").update(runtime).digest("hex");
}

function artifactFiles(document: string, runtime: string): TemplateArtifact["files"] {
  return {
    "index.html": { body: document, contentType: "text/html; charset=utf-8" },
    "runtime.mjs": { body: runtime, contentType: "text/javascript; charset=utf-8" },
  };
}

const memoryBoxSpikeArtifact: TemplateArtifact = {
  contentHash: computeContentHash(MEMORY_BOX_SPIKE_DOCUMENT, MEMORY_BOX_SPIKE_RUNTIME),
  files: artifactFiles(MEMORY_BOX_SPIKE_DOCUMENT, MEMORY_BOX_SPIKE_RUNTIME),
  fixtures: Object.fromEntries(
    Object.entries(MEMORY_BOX_SPIKE_FIXTURES).map(([name, payload]) => [
      name,
      { assets: {}, payload },
    ]),
  ),
  id: "memory-box-spike",
  version: "0.1.0",
};

// Released Memory Box versions are served only from their committed release files, never from a
// rebuild of the template source, so published gifts keep the exact bytes they pinned.
const memoryBoxReleaseArtifacts = MEMORY_BOX_RELEASES.map((release): TemplateArtifact => ({
  contentHash: computeContentHash(release.files["index.html"], release.files["runtime.mjs"]),
  files: artifactFiles(release.files["index.html"], release.files["runtime.mjs"]),
  // Harness fixtures are keyed per release and validated against that release's manifest.
  fixtures: MEMORY_BOX_HARNESS_FIXTURES[release.version] ?? {},
  id: "memory-box",
  version: release.version,
}));

const artifacts = new Map(
  [memoryBoxSpikeArtifact, ...memoryBoxReleaseArtifacts].map((artifact) => [
    `${artifact.id}@${artifact.version}`,
    artifact,
  ]),
);

export function getTemplateArtifact(id: string, version: string): TemplateArtifact | null {
  return artifacts.get(`${id}@${version}`) ?? null;
}

export function getTemplateFixture(
  id: string,
  version: string,
  fixtureName: string,
): TemplateFixture | null {
  return getTemplateArtifact(id, version)?.fixtures[fixtureName] ?? null;
}
