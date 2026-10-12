import { describe, expect, it, vi } from "vitest";

import { HtmlTemplateImportError, prepareHtmlTemplate } from "./html-template-import";
import {
  createHtmlTemplateImporter,
  htmlTemplateStorageKey,
  type HtmlTemplateRepository,
  type StoredTemplateVersionIdentity,
} from "./import-html-template";
import { manifestContentHash } from "./template-manifest-hash";
import { testDocument, testSource } from "./test/html-template-fixtures";

const now = new Date("2026-10-13T08:00:00.000Z");

function setup(stored: StoredTemplateVersionIdentity | null = null) {
  const repository = {
    findVersion: vi.fn<HtmlTemplateRepository["findVersion"]>(() => Promise.resolve(stored)),
    saveImport: vi.fn<HtmlTemplateRepository["saveImport"]>(() => Promise.resolve()),
  };
  const files = { putFile: vi.fn(() => Promise.resolve()) };
  const importer = createHtmlTemplateImporter({ clock: () => now, files, repository });
  return { files, importer, repository };
}

const prepared = prepareHtmlTemplate(testSource());
const sameVersion: StoredTemplateVersionIdentity = {
  artifactContentHash: prepared.artifactContentHash,
  contentHash: manifestContentHash(prepared.storedManifest),
  status: "published",
};

describe("html template import", () => {
  it("writes every file to its content-addressed key, then stores the version", async () => {
    const { files, importer, repository } = setup();

    const summary = await importer.importTemplate(testSource(), {
      operator: "truong",
      publish: true,
      sortOrder: 4,
    });

    expect(summary).toEqual({
      artifactContentHash: prepared.artifactContentHash,
      event: "template_import",
      files: 6,
      initialJsKbGzip: prepared.metrics.initialJsKbGzip,
      initialMediaKb: prepared.metrics.initialMediaKb,
      outcome: "imported",
      status: "published",
      templateId: "test-html",
      version: "1.0.0",
    });
    expect(files.putFile).toHaveBeenCalledTimes(6);
    expect(files.putFile).toHaveBeenCalledWith(
      `private/templates/test-html/1.0.0/${prepared.artifactContentHash}/assets/photo.png`,
      expect.any(Uint8Array),
      "image/png",
    );
    const saved = repository.saveImport.mock.calls[0]?.[0];
    expect(saved).toMatchObject({
      now,
      operator: "truong",
      publish: true,
      sortOrder: 4,
      stored: null,
    });
    expect(saved?.record).toMatchObject({
      artifactContentHash: prepared.artifactContentHash,
      contentHash: manifestContentHash(prepared.storedManifest),
      defaults: prepared.defaults,
      manifest: prepared.storedManifest,
      templateId: "test-html",
      version: "1.0.0",
    });
    expect(saved?.record.files[0]).toEqual({
      contentType: "text/html; charset=utf-8",
      name: "index.html",
      sha256: prepared.files[0]?.sha256,
      sizeBytes: prepared.files[0]?.sizeBytes,
      storageKey: htmlTemplateStorageKey(
        "test-html",
        "1.0.0",
        prepared.artifactContentHash,
        "index.html",
      ),
    });
  });

  it("imports a draft without publishing it, appending its sort order", async () => {
    const { importer, repository } = setup();

    const summary = await importer.importTemplate(testSource(), {
      operator: "truong",
      publish: false,
    });

    expect(summary).toMatchObject({ outcome: "imported", status: "draft" });
    expect(repository.saveImport).toHaveBeenCalledWith(
      expect.objectContaining({ publish: false, sortOrder: null }),
    );
  });

  it("changes nothing when the same version is imported again, but rewrites missing files", async () => {
    const { files, importer, repository } = setup(sameVersion);

    const summary = await importer.importTemplate(testSource(), {
      operator: "db:seed",
      publish: true,
    });

    expect(summary).toMatchObject({ outcome: "unchanged", status: "published" });
    expect(repository.saveImport).not.toHaveBeenCalled();
    expect(files.putFile).toHaveBeenCalledTimes(6);
  });

  it("publishes a stored draft of the same content", async () => {
    const { importer, repository } = setup({ ...sameVersion, status: "draft" });

    const summary = await importer.importTemplate(testSource(), {
      operator: "truong",
      publish: true,
    });

    expect(summary).toMatchObject({ outcome: "published", status: "published" });
    expect(repository.saveImport).toHaveBeenCalledWith(
      expect.objectContaining({ publish: true, stored: { ...sameVersion, status: "draft" } }),
    );
  });

  it("keeps a stored draft as it is without --publish", async () => {
    const { importer, repository } = setup({ ...sameVersion, status: "draft" });

    await expect(
      importer.importTemplate(testSource(), { operator: "truong", publish: false }),
    ).resolves.toMatchObject({ outcome: "unchanged", status: "draft" });
    expect(repository.saveImport).not.toHaveBeenCalled();
  });

  it.each([
    ["another artifact", { ...sameVersion, artifactContentHash: "0".repeat(64) }],
    ["another manifest", { ...sameVersion, contentHash: "1".repeat(64) }],
    [
      "an sdk version",
      { artifactContentHash: null, contentHash: "2".repeat(64), status: "published" },
    ],
  ] as const)(
    "refuses a version already stored with %s, writing nothing",
    async (_, stored: StoredTemplateVersionIdentity) => {
      const { files, importer, repository } = setup(stored);

      await expect(
        importer.importTemplate(testSource(), { operator: "truong", publish: true }),
      ).rejects.toThrow(HtmlTemplateImportError);
      expect(files.putFile).not.toHaveBeenCalled();
      expect(repository.saveImport).not.toHaveBeenCalled();
    },
  );

  it("refuses an invalid folder before reading the repository", async () => {
    const { importer, repository } = setup();

    await expect(
      importer.importTemplate(
        testSource({ indexHtml: testDocument({ body: '<p onclick="x()">x</p>' }) }),
        { operator: "truong", publish: true },
      ),
    ).rejects.toThrow("inline event handlers are not allowed");
    expect(repository.findVersion).not.toHaveBeenCalled();
  });
});
