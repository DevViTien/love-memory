import { type HtmlTemplateSource } from "../application/html-template-import";
import {
  type HtmlTemplateImporter,
  type HtmlTemplateImportSummary,
} from "../application/import-html-template";

/** The operator name the seed records in the audit log for the bundled templates it imports. */
export const SEED_OPERATOR = "db:seed";

/**
 * The `sortOrder` of the first bundled html template stored for the first time: after the three
 * positions (`0`–`2`) that the sdk-era seed gave `memory-box`, `our-timeline` and `midnight-wish`,
 * so fresh and earlier-seeded databases agree.
 */
export const BUNDLED_HTML_FIRST_SORT_ORDER = 3;

/**
 * `db:seed` imports every bundled `html` template folder, published, after the seeded `sdk`
 * templates (`firstSortOrder` onwards, in the order of `templates-html/catalog-order.json`, see
 * `listBundledHtmlTemplateFolders`). A template already stored keeps its `sortOrder`. The import
 * is idempotent; a folder that changed under a stored version fails the seed.
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
