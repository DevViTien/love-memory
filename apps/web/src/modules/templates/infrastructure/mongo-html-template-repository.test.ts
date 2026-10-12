import { beforeEach, describe, expect, it, vi } from "vitest";

import { type HtmlTemplateVersionRecord } from "../application/import-html-template";
import { createMongoHtmlTemplateRepository } from "./mongo-html-template-repository";

const now = new Date("2026-10-13T08:00:00.000Z");
const hash = "a".repeat(64);
const record: HtmlTemplateVersionRecord = {
  artifactContentHash: hash,
  contentHash: "b".repeat(64),
  defaults: { title: "LOVE" },
  files: [
    {
      contentType: "text/html; charset=utf-8",
      name: "index.html",
      sha256: "c".repeat(64),
      sizeBytes: 10,
      storageKey: `private/templates/love-days/1.0.0/${hash}/index.html`,
    },
  ],
  manifest: { id: "love-days", kind: "html", version: "1.0.0" },
  templateId: "love-days",
  version: "1.0.0",
};

describe("Mongo html template repository", () => {
  const templateVersions = { findOne: vi.fn(), insertOne: vi.fn(), updateOne: vi.fn() };
  const templates = {
    countDocuments: vi.fn(),
    findOne: vi.fn(),
    insertOne: vi.fn(),
    updateOne: vi.fn(),
  };
  const auditLog = { insertOne: vi.fn() };
  const session = {
    withTransaction: vi.fn(async (work: () => Promise<void>) => {
      await work();
    }),
  };
  const database = {
    collection: (name: string) => ({ auditLog, templateVersions, templates })[name],
  };
  const repository = createMongoHtmlTemplateRepository({
    client: () =>
      Promise.resolve({
        withSession: (work: (value: typeof session) => Promise<void>) => work(session),
      } as never),
    database: () => Promise.resolve(database as never),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    templateVersions.updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it("finds the stored artifact of an html version only", async () => {
    templateVersions.findOne.mockResolvedValueOnce({
      artifactContentHash: hash,
      files: record.files,
    });

    await expect(repository.findArtifact("love-days", "1.0.0")).resolves.toEqual({
      artifactContentHash: hash,
      files: record.files,
    });
    expect(templateVersions.findOne).toHaveBeenCalledWith(
      { _id: "love-days@1.0.0", kind: "html" },
      { projection: { artifactContentHash: 1, files: 1 } },
    );

    templateVersions.findOne.mockResolvedValueOnce(null);
    await expect(repository.findArtifact("memory-box", "1.1.0")).resolves.toBeNull();
    templateVersions.findOne.mockResolvedValueOnce({ artifactContentHash: hash });
    await expect(repository.findArtifact("love-days", "1.0.0")).resolves.toBeNull();
  });

  it("reads the identity of a stored version of either kind", async () => {
    templateVersions.findOne.mockResolvedValueOnce({
      artifactContentHash: hash,
      contentHash: "b".repeat(64),
      status: "draft",
    });
    await expect(repository.findVersion("love-days", "1.0.0")).resolves.toEqual({
      artifactContentHash: hash,
      contentHash: "b".repeat(64),
      status: "draft",
    });

    templateVersions.findOne.mockResolvedValueOnce({ status: "published" });
    await expect(repository.findVersion("memory-box", "1.1.0")).resolves.toEqual({
      artifactContentHash: null,
      contentHash: null,
      status: "published",
    });

    templateVersions.findOne.mockResolvedValueOnce(null);
    await expect(repository.findVersion("love-days", "2.0.0")).resolves.toBeNull();
  });

  it("stores a new published version, a new template and the audit record in one transaction", async () => {
    templates.findOne.mockResolvedValueOnce(null);

    await repository.saveImport({
      now,
      operator: "truong",
      publish: true,
      record,
      sortOrder: 3,
      stored: null,
    });

    expect(templateVersions.insertOne).toHaveBeenCalledWith(
      {
        _id: "love-days@1.0.0",
        artifactContentHash: hash,
        contentHash: record.contentHash,
        createdAt: now,
        defaults: record.defaults,
        files: record.files,
        importedAt: now,
        kind: "html",
        manifest: record.manifest,
        status: "published",
        templateId: "love-days",
        updatedAt: now,
        version: "1.0.0",
      },
      { session },
    );
    expect(templates.insertOne).toHaveBeenCalledWith(
      {
        _id: "love-days",
        createdAt: now,
        currentVersion: "1.0.0",
        sortOrder: 3,
        status: "published",
        updatedAt: now,
      },
      { session },
    );
    expect(auditLog.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.template.imported",
        actor: { id: "truong", kind: "operator" },
        metadata: { artifactHash: hash, files: 1, published: true },
        requestId: null,
        target: { id: "love-days@1.0.0", kind: "template-version" },
      }),
      { session },
    );
  });

  it("stores a draft of a new template at the end of the catalog order", async () => {
    templates.findOne.mockResolvedValueOnce(null);
    templates.countDocuments.mockResolvedValueOnce(5);

    await repository.saveImport({
      now,
      operator: "truong",
      publish: false,
      record,
      sortOrder: null,
      stored: null,
    });

    expect(templateVersions.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: "draft" }),
      { session },
    );
    expect(templates.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 5, status: "draft" }),
      { session },
    );
  });

  it("does not touch an existing template for a draft", async () => {
    templates.findOne.mockResolvedValueOnce({ _id: "love-days", currentVersion: "1.0.0" });

    await repository.saveImport({
      now,
      operator: "truong",
      publish: false,
      record: { ...record, version: "1.1.0" },
      sortOrder: null,
      stored: null,
    });

    expect(templates.insertOne).not.toHaveBeenCalled();
    expect(templates.updateOne).not.toHaveBeenCalled();
  });

  it("publishes a stored draft and makes a newer version current", async () => {
    templates.findOne.mockResolvedValueOnce({ _id: "love-days", currentVersion: "1.0.0" });
    templateVersions.findOne.mockResolvedValueOnce({ status: "published" });

    await repository.saveImport({
      now,
      operator: "truong",
      publish: true,
      record: { ...record, version: "1.1.0" },
      sortOrder: null,
      stored: { artifactContentHash: hash, contentHash: record.contentHash, status: "draft" },
    });

    expect(templateVersions.insertOne).not.toHaveBeenCalled();
    expect(templateVersions.updateOne).toHaveBeenCalledWith(
      { _id: "love-days@1.1.0", adminRetiredAt: { $exists: false }, status: "draft" },
      { $set: { status: "published", updatedAt: now } },
      { session },
    );
    expect(templates.updateOne).toHaveBeenCalledWith(
      { _id: "love-days" },
      { $set: { currentVersion: "1.1.0", status: "published", updatedAt: now } },
      { session },
    );
  });

  it("keeps a newer published current version", async () => {
    templates.findOne.mockResolvedValueOnce({ _id: "love-days", currentVersion: "2.0.0" });
    templateVersions.findOne.mockResolvedValueOnce({ status: "published" });

    await repository.saveImport({
      now,
      operator: "truong",
      publish: true,
      record,
      sortOrder: null,
      stored: null,
    });

    expect(templates.updateOne).not.toHaveBeenCalled();
  });

  it("replaces a newer current version that is not published", async () => {
    templates.findOne.mockResolvedValueOnce({ _id: "love-days", currentVersion: "2.0.0" });
    templateVersions.findOne.mockResolvedValueOnce({ status: "retired" });

    await repository.saveImport({
      now,
      operator: "truong",
      publish: true,
      record,
      sortOrder: null,
      stored: null,
    });

    expect(templates.updateOne).toHaveBeenCalledWith(
      { _id: "love-days" },
      { $set: { currentVersion: "1.0.0", status: "published", updatedAt: now } },
      { session },
    );
  });

  it("fails when the stored draft changed meanwhile, so nothing is recorded", async () => {
    templateVersions.updateOne.mockResolvedValueOnce({ matchedCount: 0 });

    await expect(
      repository.saveImport({
        now,
        operator: "truong",
        publish: true,
        record,
        sortOrder: null,
        stored: { artifactContentHash: hash, contentHash: record.contentHash, status: "draft" },
      }),
    ).rejects.toThrow("changed meanwhile");
    expect(auditLog.insertOne).not.toHaveBeenCalled();
  });
});
