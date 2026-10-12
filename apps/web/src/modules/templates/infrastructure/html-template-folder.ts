import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type HtmlTemplateAsset,
  type HtmlTemplateSource,
} from "../application/html-template-import";

/** The repository folder of the bundled `html` templates, one folder per template. */
export const BUNDLED_HTML_TEMPLATES_DIRECTORY = "templates-html";

/**
 * The committed artifact hash of a bundled template version (`{ version, artifactContentHash }`).
 * A test prepares every bundled folder and compares, so a template or bootstrap edit must bump the
 * version in the same change. The importer ignores the file and never serves it.
 */
export const HTML_TEMPLATE_LOCK_FILE = "artifact.lock.json";

/** Top-level files besides `index.html`, `template.json` and `assets/` that the importer ignores. */
const DOCUMENTATION_FILE = /\.(md|txt)$/i;

export function readLoveGiftBootstrap(): string {
  const directory = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(directory, "love-gift-bootstrap.js"), "utf8");
}

/** Refuses a symbolic link: a template folder holds its own files only. */
function assertNoLink(path: string, entry: string): void {
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error(`${entry}: symbolic links are not allowed in a template folder.`);
  }
}

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    assertNoLink(path, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

/**
 * Reads a template folder: `index.html`, `template.json` and every file under `assets/`. Any other
 * top-level entry except documentation (`*.md`, `*.txt`) and the artifact lock refuses the folder;
 * so does a symbolic link.
 */
export function readHtmlTemplateFolder(folder: string, bootstrap: string): HtmlTemplateSource {
  for (const entry of readdirSync(folder)) {
    assertNoLink(join(folder, entry), entry);
    if (["assets", "index.html", "template.json", HTML_TEMPLATE_LOCK_FILE].includes(entry))
      continue;
    if (DOCUMENTATION_FILE.test(entry) && statSync(join(folder, entry)).isFile()) continue;
    throw new Error(`${entry}: a template folder holds index.html, template.json and assets/.`);
  }
  const assetsDirectory = join(folder, "assets");
  const assets: HtmlTemplateAsset[] = existsSync(assetsDirectory)
    ? listFiles(assetsDirectory)
        .sort()
        .map((path) => ({
          bytes: new Uint8Array(readFileSync(path)),
          name: relative(folder, path).split(sep).join("/"),
        }))
    : [];
  return {
    assets,
    bootstrap,
    indexHtml: readFileSync(join(folder, "index.html"), "utf8"),
    manifest: JSON.parse(readFileSync(join(folder, "template.json"), "utf8")) as unknown,
  };
}

/** The bundled template folders, sorted by name. */
export function listBundledHtmlTemplateFolders(root: string): string[] {
  const directory = join(root, BUNDLED_HTML_TEMPLATES_DIRECTORY);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((entry) => statSync(join(directory, entry)).isDirectory())
    .sort()
    .map((entry) => join(directory, entry));
}
