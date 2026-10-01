import {
  type TemplateAvailability,
  type TemplateCatalog,
  type TemplateSummary,
} from "../domain/template-summary";

export async function listPublishedTemplates(
  catalog: TemplateCatalog,
  isAvailable: TemplateAvailability,
): Promise<readonly TemplateSummary[]> {
  const templates = await catalog.listPublished();
  return templates.map((template) => ({
    ...template,
    available: isAvailable(template.id, template.version),
  }));
}
