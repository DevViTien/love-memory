import { createHtmlTemplateImporter } from "@/modules/templates/application/import-html-template";
import { mongoHtmlTemplateRepository } from "@/modules/templates/infrastructure/mongo-html-template-repository";
import { createStorageHtmlTemplateFiles } from "@/modules/templates/infrastructure/storage-html-template-files";

import { templateStorage } from "./templates";

/**
 * `pnpm template:import` and `db:seed`: imports `html` template folders (`template-artifact-delivery`
 * "HTML template import command"). Kept out of `composition/templates.ts`, so the web server never
 * bundles the importer and its HTML parser.
 */
export function createOperatorHtmlTemplateImporter() {
  return createHtmlTemplateImporter({
    files: createStorageHtmlTemplateFiles(templateStorage()),
    repository: mongoHtmlTemplateRepository,
  });
}
