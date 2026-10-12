import { parseTemplateManifest } from "@love-memory/template-sdk";
import { describe, expect, it } from "vitest";

import { normalizeFieldValue, validateDraftContent, withFieldValue } from "./draft-validation";
import { assetIds, steppedManifest } from "./test/fixtures";

const manifest = parseTemplateManifest({
  ...steppedManifest,
  entry: "index.html",
  fields: [
    {
      id: "lines",
      itemMaxLength: 5,
      label: "Lời nhắn",
      maxItems: 2,
      minItems: 1,
      path: "lines",
      type: "textList",
    },
    { id: "photo", label: "Ảnh", path: "photo", type: "image" },
    { id: "pin", label: "Mã", length: 6, path: "pin", type: "passcode" },
    { id: "accent", label: "Màu", path: "accent", type: "color" },
  ],
  kind: "html",
  steps: undefined,
});

function field(id: string) {
  const found = manifest.fields.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown field ${id}`);
  return found;
}

describe("normalizeFieldValue for the new types", () => {
  it("keeps the non-blank lines of a text list and removes an empty one", () => {
    expect(normalizeFieldValue(field("lines"), ["Một", "  ", "Hai"])).toEqual(["Một", "Hai"]);
    expect(normalizeFieldValue(field("lines"), [" ", ""])).toBeUndefined();
    expect(normalizeFieldValue(field("lines"), "Một")).toBeUndefined();
  });

  it("removes a cleared photo, passcode or color", () => {
    expect(normalizeFieldValue(field("photo"), assetIds[0])).toBe(assetIds[0]);
    expect(normalizeFieldValue(field("photo"), "")).toBeUndefined();
    expect(normalizeFieldValue(field("pin"), "")).toBeUndefined();
    expect(normalizeFieldValue(field("accent"), "")).toBeUndefined();
    expect(withFieldValue(manifest, { photo: assetIds[0] }, "photo", "")).toEqual({});
  });
});

describe("validateDraftContent for the new types", () => {
  it("accepts a draft with fewer lines than the minimum", () => {
    expect(validateDraftContent(manifest, { lines: [] }, new Set())).toEqual({});
  });

  it("chooses Vietnamese messages by field type", () => {
    expect(
      validateDraftContent(
        manifest,
        { accent: "#12", lines: ["a", "b", "c"], photo: "x", pin: "12" },
        new Set(),
      ),
    ).toEqual({
      accent: "Màu chưa hợp lệ, hãy chọn lại.",
      lines: "Tối đa 2 dòng.",
      photo: "Nội dung này chưa hợp lệ, hãy kiểm tra lại.",
      pin: "Mã cần đúng 6 chữ số.",
    });
    expect(validateDraftContent(manifest, { lines: ["quá dài"] }, new Set())).toEqual({
      lines: "Nội dung này chưa hợp lệ, hãy kiểm tra lại.",
    });
  });
});
