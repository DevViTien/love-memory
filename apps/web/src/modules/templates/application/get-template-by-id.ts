import { type TemplateCatalog, type TemplateSummary } from "../domain/template-summary";

export async function getTemplateById(
  catalog: TemplateCatalog,
  id: string,
): Promise<TemplateSummary | undefined> {
  return catalog.findPublishedById(id);
}
