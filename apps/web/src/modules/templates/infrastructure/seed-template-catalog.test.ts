import { describe, expect, it } from "vitest";

import { seedTemplateCatalog } from "./seed-template-catalog";

describe("seed template catalog", () => {
  it("contains only validated published template summaries", async () => {
    const templates = await seedTemplateCatalog.listPublished();

    expect(templates).toHaveLength(3);
    expect(templates.every((template) => template.version === "1.0.0")).toBe(true);
    await expect(seedTemplateCatalog.findPublishedById("memory-box")).resolves.toMatchObject({
      imageRequirement: {
        maxItems: 8,
        minItems: 3,
      },
    });
  });

  it("does not expose a mutable catalog array", async () => {
    expect(Object.isFrozen(await seedTemplateCatalog.listPublished())).toBe(true);
  });
});
