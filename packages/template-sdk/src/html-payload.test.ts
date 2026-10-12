import { describe, expect, it } from "vitest";

import { parseTemplateManifest } from "./manifest";
import {
  countImageItems,
  createTemplateDraftPayloadSchema,
  createTemplatePayloadSchema,
  listImageFieldReferences,
} from "./payload";

const manifest = parseTemplateManifest({
  budgets: { initialJsKbGzip: 20, initialMediaKb: 100, maxTextureMb: 8 },
  capabilities: ["dom"],
  engineVersion: "1.0.0",
  entry: "index.html",
  fields: [
    {
      id: "lines",
      itemMaxLength: 10,
      label: "Lời nhắn",
      maxItems: 3,
      minItems: 2,
      path: "lines",
      type: "textList",
    },
    { id: "photo", label: "Ảnh", path: "photo", required: true, type: "image" },
    { id: "pin", label: "Mã", length: 4, path: "pin", type: "passcode" },
    { id: "accent", label: "Màu", path: "accent", type: "color" },
  ],
  id: "html-fixture",
  kind: "html",
  meta: {
    description: "Fixture",
    estimatedDurationSec: 10,
    moods: ["warm"],
    name: "Fixture",
    occasions: ["anniversary"],
  },
  previewFixture: "index.html",
  status: "draft",
  version: "1.0.0",
});

const full = createTemplatePayloadSchema(manifest);
const draft = createTemplateDraftPayloadSchema(manifest);
const assetId = "550e8400-e29b-41d4-a716-446655440000";

describe("textList values", () => {
  it("trims lines and enforces minItems in full mode only", () => {
    expect(full.parse({ lines: ["  Một ", "Hai"], photo: assetId })["lines"]).toEqual([
      "Một",
      "Hai",
    ]);
    expect(full.safeParse({ lines: ["Một"], photo: assetId }).success).toBe(false);
    expect(draft.safeParse({ lines: ["Một"] }).success).toBe(true);
    expect(draft.safeParse({ lines: [] }).success).toBe(true);
  });

  it.each([[["a", "b", "c", "d"]], [["a", "   "]], [["a", "x".repeat(11)]], [["a", 3]], ["a, b"]])(
    "refuses %j in both modes",
    (lines) => {
      expect(draft.safeParse({ lines }).success).toBe(false);
      expect(full.safeParse({ lines, photo: assetId }).success).toBe(false);
    },
  );
});

describe("image, passcode and color values", () => {
  it("accepts one asset id, exact digits and a hex color normalized to lowercase", () => {
    expect(
      full.parse({ accent: "#FFAA00", lines: ["a", "b"], photo: assetId, pin: "0420" }),
    ).toEqual({ accent: "#ffaa00", lines: ["a", "b"], photo: assetId, pin: "0420" });
  });

  it.each([
    { photo: "data:image/png;base64,AAAA" },
    { photo: [assetId] },
    { pin: "123" },
    { pin: "12345" },
    { pin: "12a4" },
    { pin: "１２３４" },
    { accent: "#fff" },
    { accent: "red" },
    { accent: "#12345g" },
  ])("refuses %j", (value) => {
    expect(draft.safeParse(value).success).toBe(false);
  });

  it("requires a required image in full mode only", () => {
    expect(full.safeParse({}).success).toBe(false);
    expect(draft.safeParse({}).success).toBe(true);
  });
});

describe("image references of an image field", () => {
  it("lists and counts a single photo as one image item", () => {
    expect(listImageFieldReferences(manifest, { photo: assetId })).toEqual([
      { assetIds: [assetId], fieldId: "photo" },
    ]);
    expect(countImageItems(manifest, { photo: assetId })).toBe(1);
    expect(listImageFieldReferences(manifest, { photo: "" })).toEqual([]);
    expect(listImageFieldReferences(manifest, { photo: 7 })).toEqual([]);
    expect(countImageItems(manifest, {})).toBe(0);
  });
});
