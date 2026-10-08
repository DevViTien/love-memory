import { describe, expect, it } from "vitest";

import { parseTemplateManifest } from "./manifest";
import {
  countImageItems,
  createTemplateDraftPayloadSchema,
  listImageFieldReferences,
  parseTemplateDraftPayload,
  parseTemplatePayload,
} from "./payload";

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

const assetId = "550e8400-e29b-41d4-a716-446655440000";

describe("template payload schema", () => {
  it("derives required, optional and constrained fields from one manifest", () => {
    expect(
      parseTemplatePayload(manifest, {
        photos: [assetId],
        theme: "rose",
        title: "Memory",
      }),
    ).toMatchObject({ title: "Memory" });
  });

  it("rejects extra fields, invalid themes and field limits", () => {
    expect(() =>
      parseTemplatePayload(manifest, { photos: [assetId], theme: "other", title: "Memory" }),
    ).toThrow();
    expect(() =>
      parseTemplatePayload(manifest, {
        photos: [assetId],
        private: "not-declared",
        title: "Memory",
      }),
    ).toThrow();
    expect(() => parseTemplatePayload(manifest, { photos: [], title: "Memory" })).toThrow();
    expect(() =>
      parseTemplatePayload(manifest, {
        photos: ["data:image/gif;base64,R0lGODlhAQABAIAAAA"],
        title: "Memory",
      }),
    ).toThrow();
    expect(() =>
      parseTemplatePayload(manifest, { photos: [assetId, assetId], title: "Memory" }),
    ).toThrow();
  });

  it("allows incomplete draft data while validating supplied fields", () => {
    expect(parseTemplateDraftPayload(manifest, {})).toEqual({});
    expect(() => parseTemplateDraftPayload(manifest, { title: "" })).toThrow();
    expect(() => parseTemplateDraftPayload(manifest, { unknown: "value" })).toThrow();
  });
});

const storyManifest = parseTemplateManifest({
  budgets: { initialJsKbGzip: 20, initialMediaKb: 100, maxTextureMb: 16 },
  capabilities: ["audio", "dom"],
  engineVersion: "1.0.0",
  entry: "index.html",
  fields: [
    {
      aspectRatio: "4:5",
      captionMaxLength: 20,
      id: "memories",
      label: "Kỷ niệm",
      maxItems: 3,
      minItems: 2,
      required: true,
      type: "captionedImageList",
    },
    {
      aspectRatio: "4:3",
      id: "photos",
      label: "Photos",
      maxItems: 2,
      minItems: 0,
      type: "imageList",
    },
    { id: "audio", label: "Nhạc", source: "licensedLibrary", type: "audio" },
  ],
  id: "story-test",
  meta: {
    description: "Captioned images",
    estimatedDurationSec: 10,
    moods: ["warm"],
    name: "Story",
    occasions: ["anniversary"],
  },
  previewFixture: "fixture.json",
  status: "draft",
  version: "1.0.0",
});

const otherAssetId = "550e8400-e29b-41d4-a716-446655440001";

describe("captionedImageList payload", () => {
  it("trims captions and keeps items without a caption", () => {
    expect(
      parseTemplatePayload(storyManifest, {
        memories: [{ assetId, caption: "  Đà Lạt 2023 🌲 " }, { assetId: otherAssetId }],
      }),
    ).toEqual({
      memories: [{ assetId, caption: "Đà Lạt 2023 🌲" }, { assetId: otherAssetId }],
    });
  });

  it.each([
    [
      "an unknown item key",
      [{ assetId, url: "https://example.com/a.jpg" }, { assetId: otherAssetId }],
    ],
    ["a blank caption", [{ assetId, caption: "   " }, { assetId: otherAssetId }]],
    ["an over-long caption", [{ assetId, caption: "x".repeat(21) }, { assetId: otherAssetId }]],
    ["a repeated asset", [{ assetId }, { assetId, caption: "Again" }]],
    ["too few items", [{ assetId }]],
    ["a non-UUID asset", [{ assetId: "data:image/png;base64,AAAA" }, { assetId }]],
    ["a bare asset id list", [assetId, otherAssetId]],
  ])("rejects %s", (_, memories) => {
    expect(() => parseTemplatePayload(storyManifest, { memories })).toThrow();
  });
});

describe("draft image lists", () => {
  const imageListManifest = parseTemplateManifest({
    ...storyManifest,
    fields: [
      {
        aspectRatio: "4:5",
        captionMaxLength: 20,
        id: "memories",
        label: "Kỷ niệm",
        maxItems: 8,
        minItems: 3,
        required: true,
        type: "captionedImageList",
      },
      {
        aspectRatio: "4:3",
        id: "photos",
        label: "Photos",
        maxItems: 5,
        minItems: 2,
        type: "imageList",
      },
    ],
  });
  const uuid = (index: number) =>
    `550e8400-e29b-41d4-a716-44665544${String(index).padStart(4, "0")}`;

  it("accepts a draft with fewer images than the minimum", () => {
    const content = { memories: [{ assetId, caption: "Một" }], photos: [] };

    expect(parseTemplateDraftPayload(imageListManifest, content)).toEqual(content);
    expect(() => parseTemplatePayload(imageListManifest, content)).toThrow();
    expect(() =>
      parseTemplatePayload(imageListManifest, {
        memories: [{ assetId }, { assetId: otherAssetId }],
      }),
    ).toThrow();
  });

  it.each([
    ["too many images", Array.from({ length: 6 }, (_, index) => uuid(index))],
    ["a repeated image", [assetId, assetId]],
  ])("still rejects %s in a draft with an issue on the field", (_, photos) => {
    const result = createTemplateDraftPayloadSchema(imageListManifest).safeParse({ photos });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path[0]).toBe("photos");
  });

  it("still applies caption rules in a draft", () => {
    const result = createTemplateDraftPayloadSchema(imageListManifest).safeParse({
      memories: [{ assetId }, { assetId: otherAssetId, caption: "x".repeat(21) }],
    });

    expect(result.error?.issues[0]?.path).toEqual(["memories", 1, "caption"]);
  });
});

describe("audio payload", () => {
  it("accepts a kebab-case track id", () => {
    expect(parseTemplateDraftPayload(storyManifest, { audio: "acoustic-morning" })).toEqual({
      audio: "acoustic-morning",
    });
  });

  it.each(["Acoustic Morning", "https://example.com/song.mp3", "", "a".repeat(81)])(
    "rejects %j",
    (audio) => {
      expect(() => parseTemplateDraftPayload(storyManifest, { audio })).toThrow();
    },
  );
});

describe("listImageFieldReferences", () => {
  it("returns asset ids for both image field types and skips empty or omitted fields", () => {
    expect(
      listImageFieldReferences(storyManifest, {
        audio: "acoustic-morning",
        memories: [{ assetId, caption: "A" }, { assetId: otherAssetId }],
        photos: [],
      }),
    ).toEqual([{ assetIds: [assetId, otherAssetId], fieldId: "memories" }]);
    expect(listImageFieldReferences(storyManifest, { photos: [otherAssetId] })).toEqual([
      { assetIds: [otherAssetId], fieldId: "photos" },
    ]);
    expect(listImageFieldReferences(storyManifest, {})).toEqual([]);
  });

  it("skips malformed stored items instead of throwing", () => {
    expect(
      listImageFieldReferences(storyManifest, {
        memories: [null, 7, { caption: "no id" }, { assetId: 3 }, { assetId }],
        photos: [null, otherAssetId, { assetId }],
      }),
    ).toEqual([
      { assetIds: [assetId], fieldId: "memories" },
      { assetIds: [otherAssetId], fieldId: "photos" },
    ]);
    expect(listImageFieldReferences(storyManifest, { memories: [null] })).toEqual([]);
  });
});

describe("countImageItems", () => {
  it("counts image items across every image field", () => {
    expect(countImageItems(storyManifest, {})).toBe(0);
    expect(
      countImageItems(storyManifest, {
        memories: [{ assetId }, { assetId: otherAssetId }, { assetId }, { assetId }, { assetId }],
      }),
    ).toBe(5);
    expect(
      countImageItems(storyManifest, {
        memories: [{ assetId, caption: "A" }, { assetId: otherAssetId }],
        photos: [otherAssetId],
      }),
    ).toBe(3);
  });

  it("does not count malformed items", () => {
    expect(countImageItems(storyManifest, { memories: [null, { assetId }], photos: [7] })).toBe(1);
  });
});
