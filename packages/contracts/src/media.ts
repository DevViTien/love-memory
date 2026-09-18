import {
  MEDIA_ASSET_LIMITS,
  MediaAssetStatusSchema,
  PublicGiftIdSchema,
} from "@love-memory/domain";
import { z } from "zod";

export const MediaAssetIdSchema = z.uuid();
export const MediaContentTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

export const MediaUploadInitRequestSchema = z
  .object({
    contentType: MediaContentTypeSchema,
    fieldId: z.string().min(1).max(80),
    fileName: z.string().min(1).max(180),
    giftPublicId: PublicGiftIdSchema,
    sizeBytes: z.number().int().positive().max(MEDIA_ASSET_LIMITS.maximumInputBytes),
  })
  .strict();

export const MediaUploadCompleteRequestSchema = z
  .object({
    assetId: MediaAssetIdSchema,
    giftPublicId: PublicGiftIdSchema,
  })
  .strict();

export const MediaAssetMutationRequestSchema = z
  .object({ giftPublicId: PublicGiftIdSchema })
  .strict();

export const MediaAssetDtoSchema = z
  .object({
    assetId: MediaAssetIdSchema,
    derivatives: z.array(
      z
        .object({
          height: z.number().int().positive(),
          url: z.url(),
          width: z.number().int().positive(),
        })
        .strict(),
    ),
    failureCode: z.string().nullable(),
    fieldId: z.string().min(1).max(80),
    placeholderDataUrl: z.string().nullable(),
    status: MediaAssetStatusSchema,
  })
  .strict();

export const MediaUploadGrantSchema = z
  .object({
    assetId: MediaAssetIdSchema,
    expiresAt: z.iso.datetime(),
    headers: z.record(z.string(), z.string()),
    method: z.literal("PUT"),
    url: z.url(),
  })
  .strict();

export const MediaUploadGrantResponseSchema = z
  .object({ data: MediaUploadGrantSchema, requestId: z.string().optional() })
  .passthrough();

export const MediaAssetResponseSchema = z.object({ data: MediaAssetDtoSchema }).passthrough();
export const MediaAssetListResponseSchema = z
  .object({ data: z.object({ assets: z.array(MediaAssetDtoSchema) }).strict() })
  .passthrough();

export type MediaAssetDto = z.infer<typeof MediaAssetDtoSchema>;
export type MediaUploadCompleteRequest = z.infer<typeof MediaUploadCompleteRequestSchema>;
export type MediaUploadInitRequest = z.infer<typeof MediaUploadInitRequestSchema>;
