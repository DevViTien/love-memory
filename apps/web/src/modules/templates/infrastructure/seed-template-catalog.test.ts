import { describe, expect, it } from "vitest";

import { seedTemplateCatalog } from "./seed-template-catalog";

describe("seed template catalog", () => {
  it("contains only validated published template summaries", () => {
    const templates = seedTemplateCatalog.listPublished();

    expect(templates).toHaveLength(3);
    expect(templates.every((template) => template.version === "1.0.0")).toBe(true);
    expect(seedTemplateCatalog.findPublishedById("memory-box")?.imageRequirement).toEqual({
      maxItems: 8,
      minItems: 3,
    });
  });

  it("does not expose a mutable catalog array", () => {
    expect(Object.isFrozen(seedTemplateCatalog.listPublished())).toBe(true);
  });
});
