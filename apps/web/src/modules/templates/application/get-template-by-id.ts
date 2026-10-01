import {
  type TemplateAvailability,
  type TemplateCatalog,
  type TemplateSummary,
} from "../domain/template-summary";

export async function getTemplateById(
  catalog: TemplateCatalog,
  isAvailable: TemplateAvailability,
  id: string,
): Promise<TemplateSummary | undefined> {
  const template = await catalog.findPublishedById(id);
  return template
    ? { ...template, available: isAvailable(template.id, template.version) }
    : undefined;
}
