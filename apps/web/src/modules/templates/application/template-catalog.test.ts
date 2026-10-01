import { describe, expect, it } from "vitest";

import { type StoredTemplateSummary, type TemplateCatalog } from "../domain/template-summary";
import { getTemplateById } from "./get-template-by-id";
import { listPublishedTemplates } from "./list-published-templates";

const memoryBox: StoredTemplateSummary = {
  description: "A story",
  estimatedDurationSec: 60,
  id: "memory-box",
  moods: ["warm"],
  name: "Memory Box",
  version: "1.1.0",
};

const timeline: StoredTemplateSummary = { ...memoryBox, id: "our-timeline", version: "1.0.0" };

const catalog: TemplateCatalog = {
  findPublishedById: (id) =>
    Promise.resolve([memoryBox, timeline].find((entry) => entry.id === id)),
  listPublished: () => Promise.resolve([memoryBox, timeline]),
};

/** Only `memory-box@1.1.0` has a registered artifact. */
const isAvailable = (id: string, version: string) => id === "memory-box" && version === "1.1.0";

describe("template catalog application services", () => {
  it("lists templates with their availability", async () => {
    await expect(listPublishedTemplates(catalog, isAvailable)).resolves.toEqual([
      { ...memoryBox, available: true },
      { ...timeline, available: false },
    ]);
  });

  it("finds a template with its availability", async () => {
    await expect(getTemplateById(catalog, isAvailable, "memory-box")).resolves.toEqual({
      ...memoryBox,
      available: true,
    });
    await expect(getTemplateById(catalog, isAvailable, "our-timeline")).resolves.toEqual({
      ...timeline,
      available: false,
    });
    await expect(getTemplateById(catalog, isAvailable, "missing")).resolves.toBeUndefined();
  });
});
