import { z } from "zod";

import { createApiSuccessSchema } from "./api";

export const UPLOAD_LIMITS = {
  fileNameMaxLength: 255,
  imageMaxBytes: 10 * 1024 * 1024,
  uploadUrlTtlSeconds: 300,
} as const;

export const UploadAssetIdSchema = z.uuid();
export const UploadContentTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

export const UploadInitRequestSchema = z
  .object({
    contentType: UploadContentTypeSchema,
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(UPLOAD_LIMITS.fileNameMaxLength)
      .refine((value) => !/[\\/\u0000-\u001f]/.test(value), {
        message: "File name contains unsupported characters.",
      }),
    sizeBytes: z.number().int().positive().max(UPLOAD_LIMITS.imageMaxBytes),
  })
  .strict();

export const UploadInitDataSchema = z
  .object({
    assetId: UploadAssetIdSchema,
    expiresAt: z.iso.datetime(),
    headers: z.record(z.string(), z.string()),
    method: z.literal("PUT"),
    uploadUrl: z.url(),
  })
  .strict();

export const UploadInitResponseSchema = createApiSuccessSchema(UploadInitDataSchema);

export const UploadCompleteRequestSchema = z.object({ assetId: UploadAssetIdSchema }).strict();
export const UploadCleanupRequestSchema = UploadCompleteRequestSchema;

export const UploadCompleteDataSchema = z
  .object({
    assetId: UploadAssetIdSchema,
    contentType: z.literal("image/webp"),
    downloadUrl: z.url(),
    height: z.number().int().positive(),
    width: z.number().int().positive(),
  })
  .strict();

export const UploadCompleteResponseSchema = createApiSuccessSchema(UploadCompleteDataSchema);

export const UploadCleanupDataSchema = z
  .object({
    assetId: UploadAssetIdSchema,
    deleted: z.literal(true),
  })
  .strict();

export const UploadCleanupResponseSchema = createApiSuccessSchema(UploadCleanupDataSchema);

export type UploadCleanupData = z.infer<typeof UploadCleanupDataSchema>;
export type UploadCleanupRequest = z.infer<typeof UploadCleanupRequestSchema>;
export type UploadCompleteData = z.infer<typeof UploadCompleteDataSchema>;
export type UploadCompleteRequest = z.infer<typeof UploadCompleteRequestSchema>;
export type UploadInitData = z.infer<typeof UploadInitDataSchema>;
export type UploadInitRequest = z.infer<typeof UploadInitRequestSchema>;
