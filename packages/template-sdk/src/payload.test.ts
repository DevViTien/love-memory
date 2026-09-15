import { describe, expect, it } from "vitest";

import { parseTemplateManifest } from "./manifest";
import { parseTemplatePayload } from "./payload";

const manifest = parseTemplateManifest({
  budgets: { initialJsKbGzip: 20, initialMediaKb: 100, maxTextureMb: 16 },
  capabilities: ["dom"],
  engineVersion: "1.0.0",
  entry: "index.html",
  fields: [
    { id: "title", label: "Title", maxLength: 10, required: true, type: "shortText" },
    {
      aspectRatio: "4:3",
      id: "photos",
      label: "Photos",
      maxItems: 2,
      minItems: 1,
      required: true,
      type: "imageList",
    },
    {
      id: "theme",
      label: "Theme",
      options: ["rose", "paper"],
      required: false,
      type: "theme",
    },
  ],
  id: "fixture-test",
  meta: {
    description: "Fixture validation",
    estimatedDurationSec: 10,
    moods: ["warm"],
    name: "Fixture",
    occasions: ["anniversary"],
  },
  previewFixture: "fixture.json",
  status: "draft",
  version: "1.0.0",
});

describe("template payload schema", () => {
  it("derives required, optional and constrained fields from one manifest", () => {
    expect(
      parseTemplatePayload(manifest, {
        photos: ["asset-1"],
        theme: "rose",
        title: "Memory",
      }),
    ).toMatchObject({ title: "Memory" });
  });

  it("rejects extra fields, invalid themes and field limits", () => {
    expect(() =>
      parseTemplatePayload(manifest, { photos: ["asset-1"], theme: "other", title: "Memory" }),
    ).toThrow();
    expect(() =>
      parseTemplatePayload(manifest, {
        photos: ["asset-1"],
        private: "not-declared",
        title: "Memory",
      }),
    ).toThrow();
    expect(() => parseTemplatePayload(manifest, { photos: [], title: "Memory" })).toThrow();
  });
});
