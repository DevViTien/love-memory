import { parseTemplateManifest } from "@love-memory/template-sdk";
import { describe, expect, it } from "vitest";

import { compareSemanticVersions } from "./semantic-version-order";
import { summarizeTemplateManifest } from "./summarize-template";

const base = {
  budgets: { initialJsKbGzip: 20, initialMediaKb: 100, maxTextureMb: 8 },
  capabilities: ["dom"],
  engineVersion: "1.0.0",
  entry: "index.html",
  id: "love-days",
  kind: "html",
  meta: {
    description: "Đếm ngày.",
    estimatedDurationSec: 45,
    moods: ["romantic"],
    name: "Trái tim yêu thương",
    occasions: ["anniversary"],
  },
  previewFixture: "index.html",
  status: "published",
  version: "1.0.0",
} as const;

describe("summarizeTemplateManifest", () => {
  it("adds up the photo range of every image field (Template with single photo fields)", () => {
    const manifest = parseTemplateManifest({
      ...base,
      fields: [
        { id: "avatar", label: "Ảnh đại diện", path: "avatar", type: "image" },
        { id: "photo", label: "Ảnh", path: "photo", required: true, type: "image" },
        {
          aspectRatio: "4:5",
          id: "photos",
          label: "Ảnh kỷ niệm",
          maxItems: 4,
          minItems: 2,
          path: "photos",
          type: "imageList",
        },
      ],
    });

    expect(summarizeTemplateManifest(manifest)).toEqual({
      description: "Đếm ngày.",
      estimatedDurationSec: 45,
      id: "love-days",
      imageRequirement: { maxItems: 6, minItems: 3 },
      moods: ["romantic"],
      name: "Trái tim yêu thương",
      version: "1.0.0",
    });
  });

  it("has no image requirement without an image field", () => {
    const manifest = parseTemplateManifest({
      ...base,
      fields: [{ id: "name", label: "Tên", maxLength: 20, path: "name", type: "shortText" }],
    });

    expect(summarizeTemplateManifest(manifest)).not.toHaveProperty("imageRequirement");
  });
});

describe("compareSemanticVersions", () => {
  it.each([
    ["1.0.0", "1.0.0", 0],
    ["1.0.1", "1.0.0", 1],
    ["1.10.0", "1.9.0", 1],
    ["2.0.0", "10.0.0", -1],
    ["1.0.0", "1.0.0-beta", 1],
    ["1.0.0-alpha", "1.0.0", -1],
    ["1.0.0-alpha", "1.0.0-beta", -1],
    ["1.0.0-beta", "1.0.0-alpha", 1],
    ["1.0.0-beta", "1.0.0-beta", 0],
    ["1.0.0+build", "1.0.0", 0],
  ])("compares %s with %s", (left, right, sign) => {
    expect(Math.sign(compareSemanticVersions(left, right))).toBe(sign);
  });
});
