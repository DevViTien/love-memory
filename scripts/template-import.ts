import { resolve } from "node:path";

import { createOperatorHtmlTemplateImporter } from "@/composition/template-import";
import { HtmlTemplateImportError } from "@/modules/templates/application/html-template-import";
import { parseTemplateImportCommand } from "@/modules/templates/infrastructure/template-import-command";
import {
  readHtmlTemplateFolder,
  readLoveGiftBootstrap,
} from "@/modules/templates/infrastructure/html-template-folder";
import { getMongoClient } from "../packages/database/src/index";

// `pnpm template:import <folder> --operator <name> [--publish]` (`template-catalog` "HTML template
// import"): one JSON line with the outcome. A refused folder lists every problem and exits non-zero.
try {
  const command = parseTemplateImportCommand(process.argv.slice(2));
  const source = readHtmlTemplateFolder(resolve(command.folder), readLoveGiftBootstrap());
  const summary = await createOperatorHtmlTemplateImporter().importTemplate(source, {
    operator: command.operator,
    publish: command.publish,
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} catch (error) {
  if (error instanceof HtmlTemplateImportError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  const client = await getMongoClient().catch(() => undefined);
  await client?.close();
}
