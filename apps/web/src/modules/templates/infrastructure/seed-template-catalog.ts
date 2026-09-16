import { parseTemplateManifest, TEMPLATE_ENGINE_VERSION } from "@love-memory/template-sdk";

import { type TemplateCatalog, type TemplateSummary } from "../domain/template-summary";

export const seedTemplateManifests = [
  parseTemplateManifest({
    budgets: { initialJsKbGzip: 120, initialMediaKb: 700, maxTextureMb: 32 },
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
      {
        aspectRatio: "4:5",
        id: "photos",
        label: "Ảnh kỷ niệm",
        maxItems: 8,
        minItems: 3,
        required: true,
        type: "imageList",
      },
      {
        id: "final-message",
        label: "Lá thư cuối",
        maxLength: 1200,
        required: true,
        type: "longText",
      },
    ],
    id: "memory-box",
    meta: {
      description: "Mở chiếc hộp, để từng tấm ảnh bay ra và kết thúc bằng một lá thư.",
      estimatedDurationSec: 75,
      moods: ["warm", "playful"],
      name: "Hộp ký ức",
      occasions: ["anniversary", "birthday"],
    },
    previewFixture: "fixtures/demo.json",
    status: "published",
    version: "1.0.0",
  }),
  parseTemplateManifest({
    budgets: { initialJsKbGzip: 100, initialMediaKb: 650, maxTextureMb: 24 },
    capabilities: ["audio", "dom", "svg"],
    engineVersion: TEMPLATE_ENGINE_VERSION,
    entry: "index.js",
    fields: [
      {
        id: "title",
        label: "Tên câu chuyện",
        maxLength: 100,
        required: true,
        type: "shortText",
      },
      {
        aspectRatio: "4:5",
        id: "milestones",
        label: "Các cột mốc",
        maxItems: 7,
        minItems: 4,
        required: true,
        type: "imageList",
      },
    ],
    id: "our-timeline",
    meta: {
      description: "Kể lại hành trình qua những cột mốc nhỏ chỉ hai người mới nhớ.",
      estimatedDurationSec: 90,
      moods: ["nostalgic", "warm"],
      name: "Dòng thời gian hai đứa",
      occasions: ["anniversary", "long-distance"],
    },
    previewFixture: "fixtures/demo.json",
    status: "published",
    version: "1.0.0",
  }),
  parseTemplateManifest({
    budgets: { initialJsKbGzip: 135, initialMediaKb: 500, maxTextureMb: 32 },
    capabilities: ["audio", "canvas2d", "dom"],
    engineVersion: TEMPLATE_ENGINE_VERSION,
    entry: "index.js",
    fields: [
      {
        id: "receiver-name",
        label: "Tên người nhận",
        maxLength: 40,
        required: true,
        type: "shortText",
      },
      {
        id: "wishes",
        label: "Những lời nhắn trên bầu trời",
        maxLength: 900,
        required: true,
        type: "longText",
      },
    ],
    id: "midnight-wish",
    meta: {
      description: "Chạm những vì sao để mở lời nhắn và kết thúc bằng một bầu trời pháo hoa.",
      estimatedDurationSec: 60,
      moods: ["dreamy", "romantic"],
      name: "Bầu trời lời nhắn",
      occasions: ["confession", "birthday"],
    },
    previewFixture: "fixtures/demo.json",
    status: "published",
    version: "1.0.0",
  }),
] as const;

const templates = Object.freeze(
  seedTemplateManifests.map<TemplateSummary>((manifest) => {
    const imageField = manifest.fields.find((field) => field.type === "imageList");

    return {
      description: manifest.meta.description,
      estimatedDurationSec: manifest.meta.estimatedDurationSec,
      id: manifest.id,
      ...(imageField
        ? { imageRequirement: { maxItems: imageField.maxItems, minItems: imageField.minItems } }
        : {}),
      moods: manifest.meta.moods,
      name: manifest.meta.name,
      version: manifest.version,
    };
  }),
);

export const seedTemplateCatalog: TemplateCatalog = {
  findPublishedById(id) {
    return Promise.resolve(templates.find((template) => template.id === id));
  },
  listPublished() {
    return Promise.resolve(templates);
  },
};
