import {
  MEMORY_BOX_SPIKE_DOCUMENT,
  MEMORY_BOX_SPIKE_FIXTURES,
  MEMORY_BOX_SPIKE_RUNTIME,
} from "@love-memory/template-memory-box-spike";
import type { TemplateMessagePayload } from "@love-memory/template-sdk";
import { createHash } from "node:crypto";

export type TemplateArtifact = Readonly<{
  contentHash: string;
  files: Readonly<Record<string, Readonly<{ body: string; contentType: string }>>>;
  fixtures: Readonly<Record<string, TemplateMessagePayload>>;
  id: string;
  version: string;
}>;

const memoryBoxContentHash = createHash("sha256")
  .update(MEMORY_BOX_SPIKE_DOCUMENT)
  .update("\0")
  .update(MEMORY_BOX_SPIKE_RUNTIME)
  .digest("hex");

const memoryBoxArtifact: TemplateArtifact = {
  contentHash: memoryBoxContentHash,
  files: {
    "index.html": { body: MEMORY_BOX_SPIKE_DOCUMENT, contentType: "text/html; charset=utf-8" },
    "runtime.mjs": {
      body: MEMORY_BOX_SPIKE_RUNTIME,
      contentType: "text/javascript; charset=utf-8",
    },
  },
  fixtures: MEMORY_BOX_SPIKE_FIXTURES,
  id: "memory-box-spike",
  version: "0.1.0",
};

const artifacts = new Map([
  [`${memoryBoxArtifact.id}@${memoryBoxArtifact.version}`, memoryBoxArtifact],
]);

export function getTemplateArtifact(id: string, version: string): TemplateArtifact | null {
  return artifacts.get(`${id}@${version}`) ?? null;
}

export function getTemplateFixture(
  id: string,
  version: string,
  fixtureName: string,
): TemplateMessagePayload | null {
  return getTemplateArtifact(id, version)?.fixtures[fixtureName] ?? null;
}
