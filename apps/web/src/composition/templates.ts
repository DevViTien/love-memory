import { getTemplateById } from "@/modules/templates/application/get-template-by-id";
import { listPublishedTemplates } from "@/modules/templates/application/list-published-templates";
import { mongoTemplateCatalog } from "@/modules/templates/infrastructure/mongo-template-catalog";

export async function getPublishedTemplateById(id: string) {
  return getTemplateById(mongoTemplateCatalog, id);
}

export async function getPublishedTemplates() {
  return listPublishedTemplates(mongoTemplateCatalog);
}
