import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { BOOTSTRAP_FIELDS_MARKER, prepareHtmlTemplate } from "../application/html-template-import";
import {
  BUNDLED_HTML_TEMPLATES_DIRECTORY,
  BUNDLED_HTML_TEMPLATES_ORDER_FILE,
  HTML_TEMPLATE_LOCK_FILE,
  listBundledHtmlTemplateFolders,
  readHtmlTemplateFolder,
  readLoveGiftBootstrap,
} from "./html-template-folder";
import { SEED_OPERATOR, seedBundledHtmlTemplates } from "./seed-html-templates";
import { parseTemplateImportCommand } from "./template-import-command";

const repositoryRoot = join(__dirname, "../../../../../..");
const directories: string[] = [];

function temporaryFolder(): string {
  const directory = mkdtempSync(join(tmpdir(), "html-template-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

describe("html template folders", () => {
  it("reads index.html, template.json and every asset, ignoring documentation files", () => {
    const folder = temporaryFolder();
    mkdirSync(join(folder, "assets", "fonts"), { recursive: true });
    writeFileSync(join(folder, "index.html"), "<!doctype html>");
    writeFileSync(join(folder, "template.json"), '{"id":"x"}');
    writeFileSync(join(folder, "OFL.txt"), "license");
    writeFileSync(join(folder, "README.md"), "notes");
    writeFileSync(join(folder, "artifact.lock.json"), "{}");
    writeFileSync(join(folder, "assets", "photo.jpg"), new Uint8Array([1]));
    writeFileSync(join(folder, "assets", "fonts", "hand.woff2"), new Uint8Array([2]));

    const source = readHtmlTemplateFolder(folder, "bootstrap");

    expect(source.indexHtml).toBe("<!doctype html>");
    expect(source.manifest).toEqual({ id: "x" });
    expect(source.bootstrap).toBe("bootstrap");
    expect(source.assets.map((asset) => asset.name)).toEqual([
      "assets/fonts/hand.woff2",
      "assets/photo.jpg",
    ]);
  });

  it("refuses any other top-level entry", () => {
    const folder = temporaryFolder();
    writeFileSync(join(folder, "index.html"), "");
    writeFileSync(join(folder, "template.json"), "{}");
    writeFileSync(join(folder, "script.js"), "");

    expect(() => readHtmlTemplateFolder(folder, "")).toThrow(
      "script.js: a template folder holds index.html, template.json and assets/.",
    );
  });

  it("refuses symbolic links", (context) => {
    const folder = temporaryFolder();
    const outside = temporaryFolder();
    writeFileSync(join(folder, "index.html"), "");
    writeFileSync(join(folder, "template.json"), "{}");
    writeFileSync(join(outside, "secret.png"), "x");
    mkdirSync(join(folder, "assets"));
    try {
      symlinkSync(join(outside, "secret.png"), join(folder, "assets", "photo.png"), "file");
    } catch {
      // Windows without the symlink privilege cannot create one; nothing to refuse then.
      context.skip();
    }

    expect(() => readHtmlTemplateFolder(folder, "")).toThrow(
      "photo.png: symbolic links are not allowed in a template folder.",
    );
  });

  it("reads a folder without assets", () => {
    const folder = temporaryFolder();
    writeFileSync(join(folder, "index.html"), "");
    writeFileSync(join(folder, "template.json"), "{}");

    expect(readHtmlTemplateFolder(folder, "").assets).toEqual([]);
  });

  const folderName = (folder: string) => folder.split(/[\\/]/).pop();

  it("lists the bundled template folders in catalog order, or none without the directory", () => {
    expect(listBundledHtmlTemplateFolders(repositoryRoot).map(folderName)).toEqual([
      "love-days",
      "envelope-letter",
      "galaxy-text",
      "heart-photo",
      "matrix-text",
      "memories",
    ]);
    expect(listBundledHtmlTemplateFolders(temporaryFolder())).toEqual([]);
  });

  it("lists every bundled folder in catalog-order.json exactly once", () => {
    const order = JSON.parse(
      readFileSync(
        join(repositoryRoot, BUNDLED_HTML_TEMPLATES_DIRECTORY, BUNDLED_HTML_TEMPLATES_ORDER_FILE),
        "utf8",
      ),
    ) as string[];
    const folders = listBundledHtmlTemplateFolders(repositoryRoot).map(folderName);

    expect([...order].sort()).toEqual([...folders].sort());
  });

  it("lists unlisted folders after the catalog order by name, and all by name without it", () => {
    const root = temporaryFolder();
    const directory = join(root, BUNDLED_HTML_TEMPLATES_DIRECTORY);
    for (const id of ["c", "a", "d", "b"]) mkdirSync(join(directory, id), { recursive: true });
    const names = () => listBundledHtmlTemplateFolders(root).map(folderName);

    expect(names()).toEqual(["a", "b", "c", "d"]);
    writeFileSync(join(directory, BUNDLED_HTML_TEMPLATES_ORDER_FILE), '["c", "a"]');
    expect(names()).toEqual(["c", "a", "b", "d"]);
    writeFileSync(join(directory, BUNDLED_HTML_TEMPLATES_ORDER_FILE), '{"order": ["c"]}');
    expect(names).toThrow("catalog-order.json must be a JSON list of template ids.");
  });

  it("ships a bootstrap with the field marker", () => {
    expect(readLoveGiftBootstrap()).toContain(BOOTSTRAP_FIELDS_MARKER);
  });
});

describe("bundled templates", () => {
  it.each(listBundledHtmlTemplateFolders(repositoryRoot))(
    "imports %s cleanly with its locked artifact hash",
    (folder) => {
      const prepared = prepareHtmlTemplate(readHtmlTemplateFolder(folder, readLoveGiftBootstrap()));
      const lock = JSON.parse(readFileSync(join(folder, HTML_TEMPLATE_LOCK_FILE), "utf8")) as {
        artifactContentHash: string;
        version: string;
      };

      expect(prepared.manifest.id).toBe(folder.split(/[\\/]/).pop());
      expect(prepared.manifest.kind).toBe("html");
      // A changed folder or bootstrap needs a new version and lock (templates-html/README.md).
      expect({
        artifactContentHash: prepared.artifactContentHash,
        version: prepared.manifest.version,
      }).toEqual(lock);
    },
  );

  it("maps love-days fields into its configuration", () => {
    const prepared = prepareHtmlTemplate(
      readHtmlTemplateFolder(
        join(repositoryRoot, "templates-html", "love-days"),
        readLoveGiftBootstrap(),
      ),
    );

    expect(prepared.manifest.meta.name).toBe("Trái tim yêu thương");
    expect(prepared.manifest.fields.map((field) => [field.id, field.type, field.path])).toEqual([
      ["start-date", "date", "startDate"],
      ["person1-name", "shortText", "person1.name"],
      ["person1-avatar", "image", "person1.avatar"],
      ["person2-name", "shortText", "person2.name"],
      ["person2-avatar", "image", "person2.avatar"],
      ["photo", "image", "photo"],
      ["hint", "shortText", "hint"],
      ["popup-caption", "shortText", "popupCaption"],
      ["audio", "audio", undefined],
    ]);
    expect(prepared.files.map((file) => file.name)).toEqual(
      expect.arrayContaining([
        "index.html",
        "love-gift.js",
        "script-1.js",
        "assets/fonts/patrick-hand-vietnamese.woff2",
        "assets/photo.jpg",
        "assets/thumbnail.jpg",
      ]),
    );
  });
});

describe("seedBundledHtmlTemplates", () => {
  it("imports every folder published, after the sdk templates, as the seed operator", async () => {
    const importer = {
      importTemplate: vi.fn((_source: unknown, options: { sortOrder?: number | null }) =>
        Promise.resolve({ sortOrder: options.sortOrder } as never),
      ),
    };
    const readFolder = vi.fn((folder: string) => ({ folder }) as never);

    const summaries = await seedBundledHtmlTemplates(importer, ["a", "b"], readFolder, 3);

    expect(summaries).toEqual([{ sortOrder: 3 }, { sortOrder: 4 }]);
    expect(importer.importTemplate).toHaveBeenNthCalledWith(
      1,
      { folder: "a" },
      { operator: SEED_OPERATOR, publish: true, sortOrder: 3 },
    );
    expect(importer.importTemplate).toHaveBeenNthCalledWith(
      2,
      { folder: "b" },
      { operator: "db:seed", publish: true, sortOrder: 4 },
    );
  });
});

describe("parseTemplateImportCommand", () => {
  it.each([
    [["templates-html/love-days", "--operator", "truong"], false],
    [["--publish", "templates-html/love-days", "--operator=truong"], true],
  ])("parses %j", (argv, publish) => {
    expect(parseTemplateImportCommand(argv)).toEqual({
      folder: "templates-html/love-days",
      operator: "truong",
      publish,
    });
  });

  it.each([
    [[]],
    [["--operator", "truong"]],
    [["a", "b", "--operator", "truong"]],
    [["a", "--force", "--operator", "truong"]],
  ])("refuses %j with the usage", (argv) => {
    expect(() => parseTemplateImportCommand(argv)).toThrow("Usage: pnpm template:import");
  });

  it.each([
    [["a"]],
    [["a", "--operator"]],
    [["a", "--operator", "--publish"]],
    [["a", `--operator=${"x".repeat(201)}`]],
  ])("requires an operator name (%#)", (argv) => {
    expect(() => parseTemplateImportCommand(argv)).toThrow("Missing operator name.");
  });
});
