import { type TemplateCatalog, type TemplateSummary } from "../domain/template-summary";

export function getTemplateById(catalog: TemplateCatalog, id: string): TemplateSummary | undefined {
  return catalog.findPublishedById(id);
}
