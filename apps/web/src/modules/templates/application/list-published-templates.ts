import { type TemplateCatalog, type TemplateSummary } from "../domain/template-summary";

export async function listPublishedTemplates(
  catalog: TemplateCatalog,
): Promise<readonly TemplateSummary[]> {
  return catalog.listPublished();
}
