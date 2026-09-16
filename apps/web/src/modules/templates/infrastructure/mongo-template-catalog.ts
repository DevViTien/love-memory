import { COLLECTIONS, getDatabase } from "@love-memory/database";
import { parseTemplateManifest, type TemplateManifest } from "@love-memory/template-sdk";

import { type TemplateCatalog, type TemplateSummary } from "../domain/template-summary";

type TemplateVersionDocument = Readonly<{
  manifest: TemplateManifest;
  status: "draft" | "published" | "retired";
  templateId: string;
  version: string;
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
    const document = await database
      .collection<TemplateVersionDocument>(COLLECTIONS.templateVersions)
      .findOne({ status: "published", templateId: id });

    return document ? toSummary(document) : undefined;
  },
  async listPublished() {
    const database = await getDatabase();
    const documents = await database
      .collection<TemplateVersionDocument>(COLLECTIONS.templateVersions)
      .find({ status: "published" })
      .sort({ templateId: 1 })
      .toArray();

    return documents.map(toSummary);
  },
};
