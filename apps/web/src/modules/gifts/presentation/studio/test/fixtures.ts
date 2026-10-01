import { type GiftDraftDto } from "@love-memory/contracts";
import { parseTemplateManifest, type TemplateManifest } from "@love-memory/template-sdk";

const base = {
  budgets: { initialJsKbGzip: 10, initialMediaKb: 0, maxTextureMb: 4 },
  capabilities: ["audio", "dom"],
  engineVersion: "1.0.0",
  entry: "index.js",
  id: "memory-box",
  meta: {
    description: "A memory box",
    estimatedDurationSec: 60,
    moods: ["warm"],
    name: "Memory Box",
    occasions: ["anniversary"],
  },
  previewFixture: "fixture.json",
  status: "published",
} as const;

/** A stand-in for `memory-box@1.1.0`, following docs/templates/memory-box-storyboard.md. */
export const steppedManifest: TemplateManifest = parseTemplateManifest({
  ...base,
  fields: [
    {
      id: "receiver-name",
      label: "Tên người nhận",
      maxLength: 40,
      required: true,
      type: "shortText",
    },
    { id: "anniversary-date", label: "Ngày kỷ niệm", type: "date" },
    {
      id: "opening-message",
      label: "Lời mở hộp",
      maxLength: 120,
      required: true,
      type: "shortText",
    },
    {
      aspectRatio: "4:5",
      captionMaxLength: 140,
      id: "memories",
      label: "Kỷ niệm",
      maxItems: 8,
      minItems: 3,
      required: true,
      type: "captionedImageList",
    },
    { id: "final-letter", label: "Lá thư", maxLength: 1200, required: true, type: "longText" },
    {
      id: "theme",
      label: "Giao diện",
      options: ["rose-night", "warm-paper"],
      type: "theme",
    },
    { id: "audio", label: "Nhạc nền", source: "licensedLibrary", type: "audio" },
  ],
  steps: [
    { fieldIds: ["receiver-name", "anniversary-date"], id: "recipient", label: "Người nhận" },
    { fieldIds: ["opening-message"], id: "opening", label: "Lời mở hộp" },
    { fieldIds: ["memories"], id: "memories", label: "Kỷ niệm" },
    { fieldIds: ["final-letter"], id: "letter", label: "Lá thư" },
    { fieldIds: ["theme", "audio"], id: "style", label: "Giao diện & nhạc" },
  ],
  version: "1.1.0",
});

/** A manifest without `steps`, like the Sprint 2 templates. */
export const flatManifest: TemplateManifest = parseTemplateManifest({
  ...base,
  fields: [
    { id: "headline", label: "Tiêu đề", maxLength: 40, required: true, type: "shortText" },
    {
      aspectRatio: "4:3",
      id: "photos",
      label: "Ảnh",
      maxItems: 2,
      minItems: 1,
      type: "imageList",
    },
    { id: "final-message", label: "Lời nhắn", maxLength: 200, type: "longText" },
  ],
  id: "our-timeline",
  version: "1.0.0",
});

export const assetIds = [
  "550e8400-e29b-41d4-a716-446655440000",
  "550e8400-e29b-41d4-a716-446655440001",
  "550e8400-e29b-41d4-a716-446655440002",
] as const;

export function draftGift(
  content: Record<string, unknown> = {},
  overrides: Partial<GiftDraftDto> = {},
): GiftDraftDto {
  return {
    content,
    createdAt: "2026-10-01T00:00:00.000Z",
    ownerKind: "anonymous",
    publicId: "q1w2e3r4t5y6u7i8",
    revision: 0,
    status: "draft",
    templateId: "memory-box",
    templateVersion: "1.1.0",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

export function apiError(
  code: string,
  extra: Readonly<{
    details?: Record<string, number | string>;
    fieldErrors?: Record<string, string>;
  }> = {},
): unknown {
  return { error: { code, message: "Request failed.", requestId: "request-1", ...extra } };
}
