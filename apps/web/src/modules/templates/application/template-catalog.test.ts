import { describe, expect, it } from "vitest";

import { type TemplateCatalog, type TemplateSummary } from "../domain/template-summary";
import { getTemplateById } from "./get-template-by-id";
import { listPublishedTemplates } from "./list-published-templates";

const template: TemplateSummary = {
  description: "A story",
  estimatedDurationSec: 60,
  id: "memory-box",
  moods: ["warm"],
  name: "Memory Box",
  version: "1.0.0",
};

const catalog: TemplateCatalog = {
  findPublishedById: (id) => Promise.resolve(id === template.id ? template : undefined),
  listPublished: () => Promise.resolve([template]),
};

describe("template catalog application services", () => {
  it("lists templates through the catalog port", async () => {
    await expect(listPublishedTemplates(catalog)).resolves.toEqual([template]);
  });

  it("finds a template through the catalog port", async () => {
    await expect(getTemplateById(catalog, "memory-box")).resolves.toBe(template);
    await expect(getTemplateById(catalog, "missing")).resolves.toBeUndefined();
  });
});
