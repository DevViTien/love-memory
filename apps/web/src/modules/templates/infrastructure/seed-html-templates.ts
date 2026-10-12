import { type HtmlTemplateSource } from "../application/html-template-import";
import {
  type HtmlTemplateImporter,
  type HtmlTemplateImportSummary,
} from "../application/import-html-template";

/** The operator name the seed records in the audit log for the bundled templates it imports. */
export const SEED_OPERATOR = "db:seed";

/**
 * `db:seed` imports every bundled `html` template folder, published, after the seeded `sdk`
 * templates (`firstSortOrder` onwards, in folder name order). The import is idempotent; a folder
 * that changed under a stored version fails the seed.
 */
export async function seedBundledHtmlTemplates(
  importer: Pick<HtmlTemplateImporter, "importTemplate">,
  folders: readonly string[],
  readFolder: (folder: string) => HtmlTemplateSource,
  firstSortOrder: number,
): Promise<readonly HtmlTemplateImportSummary[]> {
  const summaries: HtmlTemplateImportSummary[] = [];
  for (const [index, folder] of folders.entries()) {
    summaries.push(
      await importer.importTemplate(readFolder(folder), {
        operator: SEED_OPERATOR,
        publish: true,
        sortOrder: firstSortOrder + index,
      }),
    );
  }
  return summaries;
}
