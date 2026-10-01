import { type LicensedAudioTrackDto } from "@love-memory/contracts";
import { type MediaAsset } from "@love-memory/domain";
import { MEMORY_BOX_RELEASES } from "@love-memory/template-memory-box";
import { parseTemplateManifest, type TemplateManifest } from "@love-memory/template-sdk";

import { type ViewerPayload } from "../application/viewer-payload";

export const memoryBoxManifest: TemplateManifest = parseTemplateManifest(
  MEMORY_BOX_RELEASES.find((release) => release.version === "1.1.0")!.manifest,
);

/** The retired version: same fields, no registered artifact. */
export const retiredMemoryBoxManifest: TemplateManifest = {
  ...memoryBoxManifest,
  version: "1.0.0",
};

export const giftId = "3d594650-3436-4ca1-8a1a-5fc8a10bd154";
export const otherGiftId = "9b2f3c1e-0d7a-4a55-9c1b-2f0e6a7d8c90";
export const assetIds = [
  "550e8400-e29b-41d4-a716-446655440000",
  "550e8400-e29b-41d4-a716-446655440001",
  "550e8400-e29b-41d4-a716-446655440002",
  "550e8400-e29b-41d4-a716-446655440003",
] as const;

export const activeTrack: LicensedAudioTrackDto = {
  artist: "Nhóm Sóng",
  durationSec: 128,
  id: "acoustic-morning",
  title: "Buổi sáng mộc",
  url: "/audio-library/acoustic-morning.3f9a0c1d2e4b5a67.mp3",
};

const now = new Date("2026-10-01T10:00:00.000Z");

export function mediaAsset(
  id: string,
  overrides: Partial<MediaAsset> & Readonly<{ widths?: readonly number[] }> = {},
): MediaAsset {
  const { widths = [320, 768, 1280], ...rest } = overrides;
  return {
    anonymousDraftId: null,
    attempts: 1,
    checksumSha256: "c".repeat(64),
    createdAt: now,
    declaredContentType: "image/jpeg",
    declaredSizeBytes: 1024,
    derivatives: widths.map((width) => ({
      contentType: "image/webp",
      height: Math.round((width * 5) / 4),
      key: `private/assets/${id}/w${width}.webp`,
      width,
    })),
    expiresAt: null,
    failureCode: null,
    fieldId: "memories",
    fieldSlot: 0,
    giftId,
    giftSlot: 0,
    id,
    ownerId: "user-1",
    placeholderDataUrl: null,
    sourceKey: `private/assets/${id}/source`,
    status: "ready",
    updatedAt: now,
    ...rest,
  };
}

/** Content that passes full `memory-box@1.1.0` validation. */
export function completeContent(): Record<string, unknown> {
  return {
    "anniversary-date": "2023-02-14",
    audio: "acoustic-morning",
    "final-letter": "Cảm ơn em\nvì tất cả.",
    memories: [
      { assetId: assetIds[0], caption: "Đà Lạt 2023 🌲" },
      { assetId: assetIds[1] },
      { assetId: assetIds[2], caption: "Biển" },
    ],
    "opening-message": "Mở hộp nhé",
    "receiver-name": "An",
    theme: "rose-night",
  };
}

export const viewerFields: ViewerPayload["fields"] = memoryBoxManifest.fields.map((field) => ({
  id: field.id,
  label: field.label,
  required: field.required,
  type: field.type,
  ...(field.type === "captionedImageList" || field.type === "imageList"
    ? { maxItems: field.maxItems, minItems: field.minItems }
    : {}),
}));

export function viewerPayload(overrides: Partial<ViewerPayload> = {}): ViewerPayload {
  return {
    artifactUrl: `/template-artifacts/memory-box/1.1.0/${"a".repeat(64)}/index.html`,
    assets: {
      [assetIds[0]]: "https://blob.example/signed/0",
      [assetIds[1]]: "https://blob.example/signed/1",
      [assetIds[2]]: "https://blob.example/signed/2",
    },
    assetsExpireAt: new Date(now.getTime() + 300_000).toISOString(),
    audioUrl: activeTrack.url,
    fields: viewerFields,
    issues: [],
    payload: completeContent(),
    ...overrides,
  };
}
