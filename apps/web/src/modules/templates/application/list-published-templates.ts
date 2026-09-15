import { type TemplateCatalog, type TemplateSummary } from "../domain/template-summary";

export function listPublishedTemplates(catalog: TemplateCatalog): readonly TemplateSummary[] {
  return catalog.listPublished();
}
