import { COLLECTIONS, getDatabase } from "@love-memory/database";
import { parseTemplateManifest, type TemplateManifest } from "@love-memory/template-sdk";

import { type GiftTemplateRepository } from "../application/gift-service";

type TemplateVersionDocument = Readonly<{
  manifest: TemplateManifest;
  status: "draft" | "published" | "retired";
  templateId: string;
  version: string;
}>;

export const mongoGiftTemplateRepository: GiftTemplateRepository = {
  async findPublishedManifest(templateId, version) {
    const database = await getDatabase();
    const document = await database
      .collection<TemplateVersionDocument>(COLLECTIONS.templateVersions)
      .findOne({ status: "published", templateId, version });

    return document ? parseTemplateManifest(document.manifest) : null;
  },
};
