import { COLLECTIONS, getDatabase } from "@love-memory/database";
import { TemplateManifestSchema, type TemplateManifest } from "@love-memory/template-sdk";

import { reportUnreadableTemplateManifest } from "@/observability/operational-errors";

import { summarizeTemplateManifest } from "../application/summarize-template";
import { type StoredTemplateSummary, type TemplateCatalog } from "../domain/template-summary";

type TemplateVersionDocument = Readonly<{
  manifest: TemplateManifest;
  status: "draft" | "published" | "retired";
  templateId: string;
  version: string;
}>;

type TemplateDocument = Readonly<{
  _id: string;
  currentVersion: string;
  sortOrder: number;
  status: "draft" | "published" | "retired";
}>;

/**
 * The summary of a stored version, or `null` when this build cannot read its manifest: the entry
 * is left out and reported, so one unreadable version (for example an html template after a
 * rollback) never fails the whole catalog.
 */
function toSummary(document: TemplateVersionDocument): StoredTemplateSummary | null {
  const parsed = TemplateManifestSchema.safeParse(document.manifest);
  if (parsed.success) return summarizeTemplateManifest(parsed.data);
  reportUnreadableTemplateManifest(`${document.templateId}@${document.version}`);
  return null;
}

export const mongoTemplateCatalog: TemplateCatalog = {
  async findPublishedById(id) {
    const database = await getDatabase();
    const template = await database
      .collection<TemplateDocument>(COLLECTIONS.templates)
      .findOne({ _id: id, status: "published" });
    if (!template) {
      return undefined;
    }

    const document = await database
      .collection<TemplateVersionDocument>(COLLECTIONS.templateVersions)
      .findOne({ status: "published", templateId: id, version: template.currentVersion });

    return (document && toSummary(document)) ?? undefined;
  },
  async listPublished() {
    const database = await getDatabase();
    const templates = await database
      .collection<TemplateDocument>(COLLECTIONS.templates)
      .find({ status: "published" })
      .sort({ sortOrder: 1, _id: 1 })
      .toArray();
    if (templates.length === 0) {
      return [];
    }

    const versions = await database
      .collection<TemplateVersionDocument>(COLLECTIONS.templateVersions)
      .find({
        $or: templates.map((template) => ({
          templateId: template._id,
          version: template.currentVersion,
        })),
        status: "published",
      })
      .toArray();
    const currentVersions = new Map(
      versions.map((document) => [`${document.templateId}@${document.version}`, document]),
    );

    return templates.flatMap((template) => {
      const document = currentVersions.get(`${template._id}@${template.currentVersion}`);
      const summary = document ? toSummary(document) : null;
      return summary ? [summary] : [];
    });
  },
};
