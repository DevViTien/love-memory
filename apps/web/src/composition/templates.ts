import { getTemplateById } from "@/modules/templates/application/get-template-by-id";
import { listPublishedTemplates } from "@/modules/templates/application/list-published-templates";
import { mongoTemplateCatalog } from "@/modules/templates/infrastructure/mongo-template-catalog";
import { getTemplateArtifact } from "@/modules/templates/infrastructure/template-artifact-registry";

/**
 * Whether a template artifact is registered for the exact version: only then can a gift created
 * from it be previewed with the template and published.
 */
export function isTemplateVersionAvailable(id: string, version: string): boolean {
  return getTemplateArtifact(id, version) !== null;
}

export async function getPublishedTemplateById(id: string) {
  return getTemplateById(mongoTemplateCatalog, isTemplateVersionAvailable, id);
}

export async function getPublishedTemplates() {
  return listPublishedTemplates(mongoTemplateCatalog, isTemplateVersionAvailable);
}
