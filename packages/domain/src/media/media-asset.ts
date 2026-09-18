import { z } from "zod";

export const MEDIA_ASSET_LIMITS = {
  maximumAttempts: 3,
  maximumAssetsPerGift: 30,
  maximumInputBytes: 10 * 1024 * 1024,
} as const;

export const MediaAssetStatusSchema = z.enum([
  "initiated",
  "uploaded",
  "processing",
  "ready",
  "failed",
  "deleting",
  "deleted",
]);

export const MediaAssetDerivativeSchema = z
  .object({
    contentType: z.literal("image/webp"),
    height: z.number().int().positive(),
    key: z.string().min(1).max(300),
    width: z.number().int().positive(),
  })
  .strict();

export const MediaAssetSchema = z
  .object({
    anonymousDraftId: z.uuid().nullable(),
    attempts: z.number().int().nonnegative(),
    checksumSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    createdAt: z.coerce.date(),
    declaredContentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    declaredSizeBytes: z.number().int().positive().max(MEDIA_ASSET_LIMITS.maximumInputBytes),
    derivatives: z.array(MediaAssetDerivativeSchema).max(6),
    expiresAt: z.coerce.date().nullable(),
    failureCode: z
      .enum(["DECODE_FAILED", "OBJECT_MISSING", "PROCESSING_FAILED", "UPLOAD_INVALID"])
      .nullable(),
    fieldId: z.string().min(1).max(80),
    fieldSlot: z.number().int().nonnegative().nullable().default(null),
    giftId: z.uuid(),
    giftSlot: z.number().int().nonnegative().nullable().default(null),
    id: z.uuid(),
    ownerId: z.string().min(1).nullable(),
    placeholderDataUrl: z.string().max(2_000).nullable(),
    sourceKey: z.string().min(1).max(300),
    status: MediaAssetStatusSchema,
    updatedAt: z.coerce.date(),
  })
  .strict()
  .superRefine((asset, context) => {
    if ((asset.ownerId === null) === (asset.anonymousDraftId === null)) {
      context.addIssue({
        code: "custom",
        message: "An asset must have exactly one user or anonymous owner.",
        path: ["ownerId"],
      });
    }
    if ((asset.giftSlot === null) !== (asset.fieldSlot === null)) {
      context.addIssue({
        code: "custom",
        message: "Gift and field quota slots must be assigned together.",
        path: ["giftSlot"],
      });
    }
    if (asset.status === "ready" && asset.derivatives.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A ready asset requires at least one derivative.",
        path: ["derivatives"],
      });
    }
  });

export type MediaAsset = z.infer<typeof MediaAssetSchema>;
export type MediaAssetDerivative = z.infer<typeof MediaAssetDerivativeSchema>;
export type MediaAssetStatus = z.infer<typeof MediaAssetStatusSchema>;

const allowedTransitions: Readonly<Record<MediaAssetStatus, readonly MediaAssetStatus[]>> = {
  initiated: ["uploaded", "failed", "deleting"],
  uploaded: ["processing", "failed", "deleting"],
  processing: ["ready", "failed", "deleting"],
  ready: ["deleting"],
  failed: ["uploaded", "processing", "deleting"],
  deleting: ["deleted", "failed"],
  deleted: [],
};

export function canTransitionMediaAsset(
  current: MediaAssetStatus,
  next: MediaAssetStatus,
): boolean {
  return allowedTransitions[current].includes(next);
}
