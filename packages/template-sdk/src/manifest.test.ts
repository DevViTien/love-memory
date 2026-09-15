import { describe, expect, it } from "vitest";

import { parseTemplateManifest, TEMPLATE_ENGINE_VERSION } from "./manifest";

const validManifest = {
  budgets: {
    initialJsKbGzip: 120,
    initialMediaKb: 700,
    maxTextureMb: 32,
  },
  capabilities: ["audio", "dom"],
  engineVersion: TEMPLATE_ENGINE_VERSION,
  entry: "index.js",
  fields: [
    {
      id: "headline",
      label: "Lời mở đầu",
      maxLength: 120,
      required: true,
      type: "shortText",
    },
  ],
  id: "memory-box",
  meta: {
    description: "Mở hộp và xem những tấm ảnh kỷ niệm.",
    estimatedDurationSec: 75,
    moods: ["warm"],
    name: "Hộp ký ức",
    occasions: ["anniversary"],
  },
  previewFixture: "fixtures/demo.json",
  status: "published",
  version: "1.0.0",
} as const;

describe("TemplateManifest", () => {
  it("parses a valid manifest", () => {
    expect(parseTemplateManifest(validManifest).id).toBe("memory-box");
  });

  it("rejects duplicate field ids", () => {
    const result = {
      ...validManifest,
      fields: [validManifest.fields[0], validManifest.fields[0]],
    };

    expect(() => parseTemplateManifest(result)).toThrow("Template field ids must be unique.");
  });

  it("rejects an unversioned template", () => {
    expect(() => parseTemplateManifest({ ...validManifest, version: "latest" })).toThrow();
  });

  it.each(["01.0.0", "1.0", "latest"])("rejects invalid semantic version %s", (version) => {
    expect(() => parseTemplateManifest({ ...validManifest, version })).toThrow();
  });

  it.each(["../index.js", "/index.js", "https://example.com/index.js", "folder\\index.js"])(
    "rejects unsafe entry path %s",
    (entry) => {
      expect(() => parseTemplateManifest({ ...validManifest, entry })).toThrow();
    },
  );

  it("rejects zero-sized image ratios", () => {
    const fields = [
      {
        aspectRatio: "0:0",
        id: "photos",
        label: "Photos",
        maxItems: 5,
        minItems: 1,
        type: "imageList",
      },
    ];

    expect(() => parseTemplateManifest({ ...validManifest, fields })).toThrow();
  });

  it("rejects duplicate capabilities", () => {
    expect(() =>
      parseTemplateManifest({ ...validManifest, capabilities: ["dom", "dom"] }),
    ).toThrow();
  });
});
