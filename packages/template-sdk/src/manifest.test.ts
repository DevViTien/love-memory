import { describe, expect, it } from "vitest";

import {
  isImageField,
  parseTemplateManifest,
  resolveTemplateSteps,
  TEMPLATE_ENGINE_VERSION,
} from "./manifest";

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

  it("rejects unknown top-level keys", () => {
    expect(() => parseTemplateManifest({ ...validManifest, layout: "grid" })).toThrow();
  });
});

const captionedField = {
  aspectRatio: "4:5",
  captionMaxLength: 140,
  id: "memories",
  label: "Kỷ niệm",
  maxItems: 8,
  minItems: 3,
  type: "captionedImageList",
} as const;

describe("captionedImageList field", () => {
  it("accepts a 4:5 field with 3 to 8 images and 140-character captions", () => {
    const manifest = parseTemplateManifest({ ...validManifest, fields: [captionedField] });

    expect(manifest.fields[0]).toMatchObject({ captionMaxLength: 140, type: "captionedImageList" });
  });

  it.each([
    { ...captionedField, aspectRatio: "0:0" },
    { ...captionedField, maxItems: 2, minItems: 3 },
    { ...captionedField, captionMaxLength: 0 },
    { ...captionedField, captionMaxLength: 201 },
    { ...captionedField, captionMaxLength: undefined },
    { ...captionedField, maxItems: 31 },
  ])("rejects invalid definition %#", (field) => {
    expect(() => parseTemplateManifest({ ...validManifest, fields: [field] })).toThrow();
  });

  it("identifies both image field types", () => {
    const manifest = parseTemplateManifest({
      ...validManifest,
      fields: [
        validManifest.fields[0],
        captionedField,
        {
          aspectRatio: "4:3",
          id: "photos",
          label: "Ảnh",
          maxItems: 3,
          minItems: 1,
          type: "imageList",
        },
      ],
    });

    expect(manifest.fields.filter(isImageField).map((field) => field.id)).toEqual([
      "memories",
      "photos",
    ]);
  });
});

describe("Studio steps", () => {
  const fields = [
    { id: "receiver-name", label: "Tên", maxLength: 40, type: "shortText" },
    captionedField,
    { id: "final-letter", label: "Thư", maxLength: 1200, type: "longText" },
  ] as const;
  const steps = [
    { fieldIds: ["receiver-name"], id: "recipient", label: "Người nhận" },
    { fieldIds: ["memories", "final-letter"], id: "story", label: "Câu chuyện" },
  ];

  it("keeps declared steps in order", () => {
    const manifest = parseTemplateManifest({ ...validManifest, fields, steps });

    expect(resolveTemplateSteps(manifest)).toEqual(steps);
  });

  it("resolves a manifest without steps to one default step", () => {
    const manifest = parseTemplateManifest({ ...validManifest, fields });

    expect(resolveTemplateSteps(manifest)).toEqual([
      { fieldIds: ["receiver-name", "memories", "final-letter"], id: "content", label: "Nội dung" },
    ]);
  });

  it.each([
    ["an unassigned field", [steps[0]]],
    [
      "a field in two steps",
      [steps[0], { ...steps[1], fieldIds: ["memories", "final-letter", "receiver-name"] }],
    ],
    ["an unknown field", [...steps, { fieldIds: ["video"], id: "extra", label: "Thêm" }]],
    ["a duplicate step id", [steps[0], { ...steps[1], id: "recipient" }]],
    [
      "nine steps",
      Array.from({ length: 9 }, (_, index) => ({
        fieldIds: index === 0 ? ["receiver-name", "memories", "final-letter"] : ["receiver-name"],
        id: `step-${index}`,
        label: "Bước",
      })),
    ],
    ["an unknown step key", [{ ...steps[0], hidden: true }, steps[1]]],
    ["an empty step", [{ ...steps[0], fieldIds: [] }, steps[1]]],
    ["the reserved step id preview", [steps[0], { ...steps[1], id: "preview" }]],
    ["the reserved step id publish", [{ ...steps[0], id: "publish" }, steps[1]]],
  ])("rejects %s", (_, invalidSteps) => {
    expect(() =>
      parseTemplateManifest({ ...validManifest, fields, steps: invalidSteps }),
    ).toThrow();
  });
});
