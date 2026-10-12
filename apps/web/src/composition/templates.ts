import { type ObjectStorage } from "@love-memory/storage";

import { getTemplateById } from "@/modules/templates/application/get-template-by-id";
import { createTemplateVersionControls } from "@/modules/templates/application/template-version-controls";
import { listPublishedTemplates } from "@/modules/templates/application/list-published-templates";
import { type TemplateArtifactHandle } from "@/modules/templates/domain/template-artifact";
import { createHtmlTemplateArtifactSource } from "@/modules/templates/infrastructure/html-template-artifacts";
import { mongoHtmlTemplateRepository } from "@/modules/templates/infrastructure/mongo-html-template-repository";
import { mongoTemplateCatalog } from "@/modules/templates/infrastructure/mongo-template-catalog";
import { mongoTemplateVersionState } from "@/modules/templates/infrastructure/mongo-template-version-state";
import {
  getTemplateArtifact,
  type TemplateArtifact,
} from "@/modules/templates/infrastructure/template-artifact-registry";

import { createStorage } from "./storage";

let storage: ObjectStorage | undefined;

/** The object storage of template files, shared with the operator import (`template-import.ts`). */
export function templateStorage(): ObjectStorage {
  // Assigned only after construction succeeds, like the media composition.
  storage ??= createStorage();
  return storage;
}

const encoder = new TextEncoder();

function toHandle(artifact: TemplateArtifact): TemplateArtifactHandle {
  return {
    contentHash: artifact.contentHash,
    id: artifact.id,
    kind: "sdk",
    readFile(name) {
      const file = Object.hasOwn(artifact.files, name) ? artifact.files[name] : undefined;
      return Promise.resolve(
        file ? { body: encoder.encode(file.body), contentType: file.contentType } : null,
      );
    },
    version: artifact.version,
  };
}

const htmlTemplateArtifacts = createHtmlTemplateArtifactSource({
  findArtifact: (templateId, version) =>
    mongoHtmlTemplateRepository.findArtifact(templateId, version),
  storage: templateStorage,
});

/**
 * The artifact of an exact template version, killed or not: an `sdk` release registered in the
 * repository, otherwise an imported `html` version from MongoDB and object storage.
 */
export async function findTemplateArtifact(
  id: string,
  version: string,
): Promise<TemplateArtifactHandle | null> {
  const artifact = getTemplateArtifact(id, version);
  return artifact ? toHandle(artifact) : htmlTemplateArtifacts.find(id, version);
}

/**
 * Whether an artifact exists for the exact version: only then can a gift created from it be
 * previewed with the template and published.
 */
export async function isTemplateVersionAvailable(id: string, version: string): Promise<boolean> {
  return (await findTemplateArtifact(id, version)) !== null;
}

/**
 * The artifact every consumer uses (viewer, preview, publish, Studio, artifact route): the
 * version's artifact, unless an admin killed the version (`template-version-controls`).
 */
export async function resolveTemplateArtifact(
  id: string,
  version: string,
): Promise<TemplateArtifactHandle | null> {
  const artifact = await findTemplateArtifact(id, version);
  if (!artifact) return null;
  return (await mongoTemplateVersionState.isKilled(id, version)) ? null : artifact;
}

export const templateVersionControls = createTemplateVersionControls({
  repository: mongoTemplateVersionState,
});

export async function getPublishedTemplateById(id: string) {
  return getTemplateById(mongoTemplateCatalog, isTemplateVersionAvailable, id);
}

export async function getPublishedTemplates() {
  return listPublishedTemplates(mongoTemplateCatalog, isTemplateVersionAvailable);
}
