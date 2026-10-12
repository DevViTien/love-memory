import { describe, expect, it } from "vitest";

import {
  ConfigPathSchema,
  imageFieldItemRange,
  isImageField,
  isListField,
  parseTemplateManifest,
  templateKindOf,
  TemplateManifestSchema,
} from "./manifest";

const base = {
  budgets: { initialJsKbGzip: 20, initialMediaKb: 100, maxTextureMb: 8 },
  capabilities: ["dom"],
  engineVersion: "1.0.0",
  entry: "index.html",
  id: "love-days",
  kind: "html",
  meta: {
    description: "Đếm ngày bên nhau.",
    estimatedDurationSec: 45,
    moods: ["romantic"],
    name: "Trái tim yêu thương",
    occasions: ["anniversary"],
  },
  previewFixture: "index.html",
  status: "published",
  version: "1.0.0",
} as const;

const htmlFields = [
  { id: "start-date", label: "Ngày", path: "startDate", required: true, type: "date" },
  { id: "name", label: "Tên", maxLength: 30, path: "person1.name", type: "shortText" },
  { id: "avatar", label: "Ảnh", path: "person1.avatar", type: "image" },
  { id: "audio", label: "Nhạc", source: "licensedLibrary", type: "audio" },
] as const;

function issues(input: unknown): string[] {
  const result = TemplateManifestSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

function withoutKind() {
  const { kind: _kind, ...sdk } = base;
  return sdk;
}

describe("template kinds and field paths", () => {
  it("parses an html manifest whose fields map into the configuration", () => {
    const manifest = parseTemplateManifest({ ...base, fields: htmlFields });

    expect(templateKindOf(manifest)).toBe("html");
    expect(manifest.fields.map((field) => field.path)).toEqual([
      "startDate",
      "person1.name",
      "person1.avatar",
      undefined,
    ]);
  });

  it("treats a manifest without kind as sdk and keeps it unchanged", () => {
    const manifest = parseTemplateManifest({
      ...withoutKind(),
      entry: "index.js",
      fields: [{ id: "title", label: "Tiêu đề", maxLength: 10, type: "shortText" }],
    });

    expect(manifest.kind).toBeUndefined();
    expect(templateKindOf(manifest)).toBe("sdk");
    expect(templateKindOf({ kind: "sdk" })).toBe("sdk");
  });

  it.each([
    ["a missing path", [{ id: "name", label: "Tên", maxLength: 30, type: "shortText" }]],
    [
      "a path on the audio field",
      [{ id: "audio", label: "Nhạc", path: "music", source: "licensedLibrary", type: "audio" }],
    ],
    [
      "a repeated path",
      [
        { id: "a", label: "A", maxLength: 3, path: "name", type: "shortText" },
        { id: "b", label: "B", maxLength: 3, path: "name", type: "shortText" },
      ],
    ],
    [
      "a path inside another field's path",
      [
        { id: "a", label: "A", maxLength: 3, path: "person", type: "shortText" },
        { id: "b", label: "B", maxLength: 3, path: "person.name", type: "shortText" },
      ],
    ],
  ])("refuses an html manifest with %s", (_, fields) => {
    expect(issues({ ...base, fields }).length).toBeGreaterThan(0);
  });

  it("requires index.html as the entry of an html template", () => {
    expect(issues({ ...base, entry: "main.html", fields: htmlFields })).toContain(
      "An html template's entry must be index.html.",
    );
  });

  it("refuses a path on an sdk field", () => {
    expect(
      issues({
        ...withoutKind(),
        fields: [
          { id: "title", label: "Tiêu đề", maxLength: 10, path: "title", type: "shortText" },
        ],
      }),
    ).toContain("Only html template fields have a path.");
  });

  it.each(["person1.name", "a", "_x.y_2", "a.b.c.d.e.f.g.h"])("accepts the path %s", (path) => {
    expect(ConfigPathSchema.safeParse(path).success).toBe(true);
  });

  it.each([
    "",
    "1name",
    "person..name",
    "person.",
    "person-name",
    "__proto__",
    "a.constructor",
    "a.prototype.b",
    "a.b.c.d.e.f.g.h.i",
    "x".repeat(201),
  ])("refuses the path %j", (path) => {
    expect(ConfigPathSchema.safeParse(path).success).toBe(false);
  });

  it("refuses an unknown kind", () => {
    expect(issues({ ...base, fields: htmlFields, kind: "react" }).length).toBeGreaterThan(0);
  });
});

describe("new field types", () => {
  const field = (definition: Record<string, unknown>) =>
    TemplateManifestSchema.safeParse({
      ...base,
      fields: [{ id: "f", label: "F", path: "f", ...definition }],
    });

  it.each([
    { itemMaxLength: 500, maxItems: 50, minItems: 0, type: "textList" },
    { itemMaxLength: 80, maxItems: 5, minItems: 2, type: "textList" },
    { type: "image" },
    { aspectRatio: "25:26", type: "image" },
    { length: 4, type: "passcode" },
    { length: 8, type: "passcode" },
    { type: "color" },
  ])("accepts %j", (definition) => {
    expect(field(definition).success).toBe(true);
  });

  it.each([
    { itemMaxLength: 501, maxItems: 5, minItems: 0, type: "textList" },
    { itemMaxLength: 0, maxItems: 5, minItems: 0, type: "textList" },
    { itemMaxLength: 50, maxItems: 51, minItems: 0, type: "textList" },
    { itemMaxLength: 50, maxItems: 2, minItems: 3, type: "textList" },
    { itemMaxLength: 50, maxItems: 2, type: "textList" },
    { aspectRatio: "0:1", type: "image" },
    { maxItems: 2, type: "image" },
    { length: 3, type: "passcode" },
    { length: 9, type: "passcode" },
    { type: "passcode" },
    { options: ["red"], type: "color" },
  ])("refuses %j", (definition) => {
    expect(field(definition).success).toBe(false);
  });

  it("classifies image and list fields", () => {
    const manifest = parseTemplateManifest({
      ...base,
      fields: [
        { id: "photo", label: "Ảnh", path: "photo", required: true, type: "image" },
        { id: "extra", label: "Ảnh phụ", path: "extra", type: "image" },
        {
          id: "lines",
          itemMaxLength: 40,
          label: "Lời nhắn",
          maxItems: 5,
          minItems: 1,
          path: "lines",
          type: "textList",
        },
        {
          aspectRatio: "4:5",
          id: "photos",
          label: "Ảnh",
          maxItems: 4,
          minItems: 2,
          path: "photos",
          type: "imageList",
        },
      ],
    });
    const imageFields = manifest.fields.filter(isImageField);

    expect(imageFields.map((item) => item.id)).toEqual(["photo", "extra", "photos"]);
    expect(manifest.fields.filter(isListField).map((item) => item.id)).toEqual(["lines", "photos"]);
    expect(imageFields.map(imageFieldItemRange)).toEqual([
      { maxItems: 1, minItems: 1 },
      { maxItems: 1, minItems: 0 },
      { maxItems: 4, minItems: 2 },
    ]);
  });
});
