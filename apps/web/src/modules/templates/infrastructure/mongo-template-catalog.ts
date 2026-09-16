import { COLLECTIONS, getDatabase } from "@love-memory/database";
import { parseTemplateManifest, type TemplateManifest } from "@love-memory/template-sdk";

import { type TemplateCatalog, type TemplateSummary } from "../domain/template-summary";

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

function toSummary(document: TemplateVersionDocument): TemplateSummary {
  const manifest = parseTemplateManifest(document.manifest);
  const imageField = manifest.fields.find((field) => field.type === "imageList");

  return {
    description: manifest.meta.description,
    estimatedDurationSec: manifest.meta.estimatedDurationSec,
    id: manifest.id,
    ...(imageField
      ? { imageRequirement: { maxItems: imageField.maxItems, minItems: imageField.minItems } }
      : {}),
    moods: manifest.meta.moods,
    name: manifest.meta.name,
    version: manifest.version,
  };
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

    return document ? toSummary(document) : undefined;
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
      return document ? [toSummary(document)] : [];
    });
  },
};
