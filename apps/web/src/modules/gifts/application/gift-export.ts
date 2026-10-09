import { type Gift, type MediaAsset } from "@love-memory/domain";

import { type GiftAccessor } from "./gift-service";

/** Signed photo URLs in an export last as long as every other download URL (`media-upload`). */
export const EXPORT_URL_TTL_SECONDS = 300;

export type GiftExportPhoto = Readonly<{
  assetId: string;
  fieldId: string;
  height: number;
  url: string;
  width: number;
}>;

/** The owner's export (`privacy-notice` "Owner export"): built field by field, never a document. */
export type GiftExport = Readonly<{
  content: Readonly<Record<string, unknown>>;
  exportedAt: string;
  gift: Readonly<{
    createdAt: string;
    publicId: string;
    revision: number;
    status: "draft" | "paused" | "published";
    templateId: string;
    templateVersion: string;
    updatedAt: string;
  }>;
  photos: readonly GiftExportPhoto[];
  photosNote: string;
  publication: Readonly<{
    expiresAt: string | null;
    planId: string | null;
    publishedAt: string;
    revision: number;
    sharePath: string;
  }> | null;
}>;

type Dependencies = Readonly<{
  assets: Readonly<{ listByGiftId: (giftId: string) => Promise<readonly MediaAsset[]> }>;
  clock?: () => Date;
  gifts: Readonly<{
    findAuthorized: (publicId: string, accessors: readonly GiftAccessor[]) => Promise<Gift | null>;
  }>;
  signDownloadUrl: (key: string, expiresInSeconds: number) => Promise<string>;
}>;

const PHOTOS_NOTE = `Mỗi đường dẫn ảnh chỉ dùng được trong ${EXPORT_URL_TTL_SECONDS / 60} phút. Hãy tải ảnh ngay hoặc tải lại dữ liệu.`;

function isExportable(status: Gift["status"]): status is "draft" | "paused" | "published" {
  return status === "draft" || status === "published" || status === "paused";
}

/**
 * The owner's export of one gift. Draft accessors export a draft; only the signed-in owner exports
 * a published or paused gift. Everything else, a gift being deleted included, is not found.
 */
export function createGiftExportService({
  assets,
  clock = () => new Date(),
  gifts,
  signDownloadUrl,
}: Dependencies) {
  return {
    async export(publicId: string, accessors: readonly GiftAccessor[]): Promise<GiftExport | null> {
      if (accessors.length === 0) return null;
      const gift = await gifts.findAuthorized(publicId, accessors);
      if (!gift || !isExportable(gift.status)) return null;
      if (gift.status !== "draft") {
        const owner = accessors.some(
          (accessor) => accessor.kind === "user" && accessor.userId === gift.ownership.ownerId,
        );
        if (!owner) return null;
      }

      const ready = (await assets.listByGiftId(gift.id)).filter(
        (asset) => asset.status === "ready" && asset.derivatives.length > 0,
      );
      const photos = await Promise.all(
        ready.map(async (asset): Promise<GiftExportPhoto> => {
          const largest = asset.derivatives.reduce((best, derivative) =>
            derivative.width > best.width ? derivative : best,
          );
          return {
            assetId: asset.id,
            fieldId: asset.fieldId,
            height: largest.height,
            url: await signDownloadUrl(largest.key, EXPORT_URL_TTL_SECONDS),
            width: largest.width,
          };
        }),
      );

      return {
        content: gift.content.data,
        exportedAt: clock().toISOString(),
        gift: {
          createdAt: gift.createdAt.toISOString(),
          publicId: gift.publicId,
          revision: gift.revision,
          status: gift.status,
          templateId: gift.content.templateId,
          templateVersion: gift.content.templateVersion,
          updatedAt: gift.updatedAt.toISOString(),
        },
        photos,
        photosNote: PHOTOS_NOTE,
        publication:
          gift.shareId && gift.publishedAt && gift.publishedRevision !== undefined
            ? {
                expiresAt: gift.expiresAt?.toISOString() ?? null,
                planId: gift.entitlement?.planId ?? null,
                publishedAt: gift.publishedAt.toISOString(),
                revision: gift.publishedRevision,
                sharePath: `/g/${gift.shareId}`,
              }
            : null,
      };
    },
  } as const;
}

export type GiftExportService = ReturnType<typeof createGiftExportService>;
