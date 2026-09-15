import { describe, expect, it } from "vitest";

import { assertTemplateBuildWithinBudget, findTemplateBudgetViolations } from "./budget";
import { parseTemplateManifest, TEMPLATE_ENGINE_VERSION } from "./manifest";

const manifest = parseTemplateManifest({
  budgets: { initialJsKbGzip: 100, initialMediaKb: 500, maxTextureMb: 32 },
  capabilities: ["dom"],
  engineVersion: TEMPLATE_ENGINE_VERSION,
  entry: "index.js",
  fields: [{ id: "headline", label: "Headline", maxLength: 80, type: "shortText" }],
  id: "memory-box",
  meta: {
    description: "A memory box",
    estimatedDurationSec: 60,
    moods: ["warm"],
    name: "Memory Box",
    occasions: ["anniversary"],
  },
  previewFixture: "fixtures/demo.json",
  status: "published",
  version: "1.0.0",
});

describe("template performance budget", () => {
  it("accepts a build within its declared limits", () => {
    expect(
      assertTemplateBuildWithinBudget(manifest, {
        initialJsKbGzip: 90,
        initialMediaKb: 450,
        maxTextureMb: 20,
      }),
    ).toEqual({ initialJsKbGzip: 90, initialMediaKb: 450, maxTextureMb: 20 });
  });

  it("reports every exceeded metric", () => {
    expect(
      findTemplateBudgetViolations(manifest, {
        initialJsKbGzip: 120,
        initialMediaKb: 450,
        maxTextureMb: 40,
      }),
    ).toEqual([
      { actual: 120, limit: 100, metric: "initialJsKbGzip" },
      { actual: 40, limit: 32, metric: "maxTextureMb" },
    ]);
  });

  it("throws a readable error for an over-budget build", () => {
    expect(() =>
      assertTemplateBuildWithinBudget(manifest, {
        initialJsKbGzip: 101,
        initialMediaKb: 500,
        maxTextureMb: 32,
      }),
    ).toThrow("initialJsKbGzip: 101 > 100");
  });
});
