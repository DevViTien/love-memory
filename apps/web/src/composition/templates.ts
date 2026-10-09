import { getTemplateById } from "@/modules/templates/application/get-template-by-id";
import { createTemplateVersionControls } from "@/modules/templates/application/template-version-controls";
import { listPublishedTemplates } from "@/modules/templates/application/list-published-templates";
import { mongoTemplateCatalog } from "@/modules/templates/infrastructure/mongo-template-catalog";
import { mongoTemplateVersionState } from "@/modules/templates/infrastructure/mongo-template-version-state";
import {
  getTemplateArtifact,
  type TemplateArtifact,
} from "@/modules/templates/infrastructure/template-artifact-registry";

/**
 * Whether a template artifact is registered for the exact version: only then can a gift created
 * from it be previewed with the template and published.
 */
export function isTemplateVersionAvailable(id: string, version: string): boolean {
  return getTemplateArtifact(id, version) !== null;
}

/**
 * The artifact every consumer uses (viewer, preview, publish, Studio, artifact route): the
 * registered one, unless an admin killed the version (`template-version-controls`).
 */
export async function resolveTemplateArtifact(
  id: string,
  version: string,
): Promise<TemplateArtifact | null> {
  const artifact = getTemplateArtifact(id, version);
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
