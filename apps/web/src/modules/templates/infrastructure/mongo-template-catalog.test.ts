import type * as DatabaseModule from "@love-memory/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type TemplateManifest } from "@love-memory/template-sdk";

import { seedTemplateCurrentManifests } from "./seed-template-catalog";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
}));

import { mongoTemplateCatalog } from "./mongo-template-catalog";

const htmlManifest = {
  budgets: { initialJsKbGzip: 20, initialMediaKb: 100, maxTextureMb: 8 },
  capabilities: ["dom"],
  engineVersion: "1.0.0",
  entry: "index.html",
  fields: [{ id: "name", label: "Tên", maxLength: 20, path: "name", type: "shortText" }],
  id: "memories",
  kind: "html",
  meta: {
    description: "Sổ kỷ niệm.",
    estimatedDurationSec: 120,
    moods: ["romantic"],
    name: "Kỷ niệm của chúng mình",
    occasions: ["anniversary"],
  },
  previewFixture: "index.html",
  status: "published",
  version: "1.0.0",
} as unknown as TemplateManifest;

/** `memory-box` from the seed, then two html manifests without image fields. */
const fixtureManifests: readonly TemplateManifest[] = [
  ...seedTemplateCurrentManifests,
  { ...htmlManifest, id: "galaxy-text", meta: { ...htmlManifest.meta, name: "Ngân hà" } },
  htmlManifest,
];

describe("Mongo template catalog", () => {
  const documents = fixtureManifests.map((manifest) => ({
    manifest,
    status: "published" as const,
    templateId: manifest.id,
    version: manifest.version,
  }));

  beforeEach(() => {
    databaseMocks.getDatabase.mockReset();
    const templates = documents.map((document, sortOrder) => ({
      _id: document.templateId,
      currentVersion: document.version,
      sortOrder,
      status: "published" as const,
    }));
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) =>
        name === "templates"
          ? {
              find: () => ({
                sort: () => ({ toArray: () => Promise.resolve(templates) }),
              }),
              findOne: (filter: Readonly<{ _id: string }>) =>
                Promise.resolve(templates.find((template) => template._id === filter._id) ?? null),
            }
          : {
              find: () => ({ toArray: () => Promise.resolve(documents) }),
              findOne: (filter: Readonly<{ templateId: string; version: string }>) =>
                Promise.resolve(
                  documents.find(
                    (document) =>
                      document.templateId === filter.templateId &&
                      document.version === filter.version,
                  ) ?? null,
                ),
            },
    });
  });

  it("maps published manifest documents to stable public summaries", async () => {
    await expect(mongoTemplateCatalog.listPublished()).resolves.toHaveLength(3);
    await expect(mongoTemplateCatalog.findPublishedById("memory-box")).resolves.toMatchObject({
      id: "memory-box",
      imageRequirement: { maxItems: 8, minItems: 3 },
    });
  });

  it("skips and reports a version whose manifest this build cannot read (Invalid stored manifest)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unreadable = documents[1];
    if (!unreadable) throw new Error("Missing fixture");
    const original = unreadable.manifest;
    Object.assign(unreadable, { manifest: { ...original, kind: "future" } });
    try {
      const listed = await mongoTemplateCatalog.listPublished();
      expect(listed.map((summary) => summary.id)).toEqual(
        documents
          .filter((document) => document !== unreadable)
          .map((document) => document.templateId),
      );
      await expect(
        mongoTemplateCatalog.findPublishedById(unreadable.templateId),
      ).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledWith("Template version skipped: unreadable manifest", {
        templateVersion: `${unreadable.templateId}@${unreadable.version}`,
      });
      expect(JSON.stringify(error.mock.calls)).not.toContain(original.meta.name);
    } finally {
      Object.assign(unreadable, { manifest: original });
      error.mockRestore();
    }
  });

  it("returns undefined for an unavailable template", async () => {
    await expect(mongoTemplateCatalog.findPublishedById("missing")).resolves.toBeUndefined();
  });

  it("selects only the current published version of each template", async () => {
    const oldVersion = { ...documents[0]!, version: "0.9.0" };
    const currentVersion = {
      ...documents[0]!,
      manifest: { ...documents[0]!.manifest, version: "2.0.0" },
      version: "2.0.0",
    };
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) =>
        name === "templates"
          ? {
              find: () => ({
                sort: () => ({
                  toArray: () =>
                    Promise.resolve([
                      {
                        _id: "memory-box",
                        currentVersion: "2.0.0",
                        sortOrder: 0,
                        status: "published",
                      },
                    ]),
                }),
              }),
              findOne: () =>
                Promise.resolve({
                  _id: "memory-box",
                  currentVersion: "2.0.0",
                  sortOrder: 0,
                  status: "published",
                }),
            }
          : {
              find: () => ({ toArray: () => Promise.resolve([oldVersion, currentVersion]) }),
              findOne: (filter: Readonly<{ version: string }>) =>
                Promise.resolve(filter.version === "2.0.0" ? currentVersion : null),
            },
    });

    await expect(mongoTemplateCatalog.listPublished()).resolves.toEqual([
      expect.objectContaining({ id: "memory-box", version: "2.0.0" }),
    ]);
    await expect(mongoTemplateCatalog.findPublishedById("memory-box")).resolves.toMatchObject({
      version: "2.0.0",
    });
  });

  function mockSingleTemplate(
    manifest: (typeof documents)[number]["manifest"],
    artifact: Readonly<Record<string, unknown>> = {},
  ) {
    const template = { _id: manifest.id, currentVersion: manifest.version, sortOrder: 0 };
    const version = {
      ...artifact,
      manifest,
      status: "published",
      templateId: manifest.id,
      version: manifest.version,
    };
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) =>
        name === "templates"
          ? { findOne: () => Promise.resolve({ ...template, status: "published" }) }
          : { findOne: () => Promise.resolve(version) },
    });
  }

  it("derives the photo requirement from a captioned image field", async () => {
    // memory-box 1.1.0 declares its photos as the captionedImageList field `memories`.
    const memoryBox = documents[0]!.manifest;
    expect(memoryBox.fields.find((field) => field.id === "memories")?.type).toBe(
      "captionedImageList",
    );
    mockSingleTemplate(memoryBox);

    await expect(mongoTemplateCatalog.findPublishedById("memory-box")).resolves.toMatchObject({
      imageRequirement: { maxItems: 8, minItems: 3 },
    });
  });

  it("omits the photo requirement when no image field is declared", async () => {
    mockSingleTemplate(documents[2]!.manifest);

    const summary = await mongoTemplateCatalog.findPublishedById("memories");

    expect(summary?.id).toBe("memories");
    expect(summary).not.toHaveProperty("imageRequirement");
  });

  const artifactContentHash = "c".repeat(64);

  it("gives an html version its assets/thumbnail.jpg as thumbnailUrl (Catalog thumbnail)", async () => {
    mockSingleTemplate(htmlManifest, {
      artifactContentHash,
      files: [
        { name: "index.html", storageKey: "private/templates/memories/1.0.0/x/index.html" },
        { name: "assets/thumbnail.jpg", storageKey: "private/templates/memories/1.0.0/x/t.jpg" },
      ],
      kind: "html",
    });

    const summary = await mongoTemplateCatalog.findPublishedById("memories");

    expect(summary?.thumbnailUrl).toBe(
      `/template-artifacts/memories/1.0.0/${artifactContentHash}/assets/thumbnail.jpg`,
    );
    // Only the file name is read: storage keys never reach a summary.
    expect(JSON.stringify(summary)).not.toContain("private/templates");
  });

  it("has no thumbnail for an html version without the file or without artifact fields", async () => {
    mockSingleTemplate(htmlManifest, {
      artifactContentHash,
      // A malformed file entry is skipped.
      files: [{ name: "index.html" }, { name: 7 }],
      kind: "html",
    });
    await expect(mongoTemplateCatalog.findPublishedById("memories")).resolves.not.toHaveProperty(
      "thumbnailUrl",
    );

    mockSingleTemplate(htmlManifest);
    await expect(mongoTemplateCatalog.findPublishedById("memories")).resolves.not.toHaveProperty(
      "thumbnailUrl",
    );
  });
});
