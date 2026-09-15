import { getTemplateById } from "@/modules/templates/application/get-template-by-id";
import { listPublishedTemplates } from "@/modules/templates/application/list-published-templates";
import { seedTemplateCatalog } from "@/modules/templates/infrastructure/seed-template-catalog";

export function getPublishedTemplateById(id: string) {
  return getTemplateById(seedTemplateCatalog, id);
}

export function getPublishedTemplates() {
  return listPublishedTemplates(seedTemplateCatalog);
}
