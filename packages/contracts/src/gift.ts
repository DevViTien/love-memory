import {
  GiftTemplateIdSchema,
  GiftTemplateVersionSchema,
  PublicGiftIdSchema,
  ShareIdSchema,
} from "@love-memory/domain";
import { z } from "zod";

import { createApiSuccessSchema } from "./api";

export { PublicGiftIdSchema, ShareIdSchema };

export const GiftIdempotencyKeySchema = z.uuid();

export const CreateGiftDraftRequestSchema = z
  .object({
    templateId: GiftTemplateIdSchema,
    templateVersion: GiftTemplateVersionSchema,
  })
  .strict();

export const UpdateGiftDraftRequestSchema = z
  .object({
    content: z.record(z.string(), z.unknown()),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const ClaimGiftDraftRequestSchema = z.object({}).strict();

/** The owner's summary of a published gift's current publication: what recipients receive. */
export const GiftPublicationSummarySchema = z
  .object({
    publishedAt: z.iso.datetime(),
    revision: z.number().int().nonnegative(),
    shareId: ShareIdSchema,
    sharePath: z.string().regex(/^\/g\/[A-Za-z0-9_-]{22}$/),
  })
  .strict();

/**
 * A draft, or the working copy of a published gift. The gift has unpublished changes exactly when
 * `revision` is greater than `publication.revision`.
 */
export const GiftDraftDtoSchema = z
  .object({
    content: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime(),
    ownerKind: z.enum(["anonymous", "user"]),
    publicId: PublicGiftIdSchema,
    publication: GiftPublicationSummarySchema.nullable(),
    revision: z.number().int().nonnegative(),
    status: z.enum(["draft", "published"]),
    templateId: GiftTemplateIdSchema,
    templateVersion: GiftTemplateVersionSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const GiftDraftResponseSchema = z
  .object({
    gift: GiftDraftDtoSchema,
  })
  .strict();

/** `POST /api/gifts/{publicId}/preview` takes no options. */
export const CreateGiftPreviewRequestSchema = z.object({}).strict();

export const GiftPreviewLinkDtoSchema = z
  .object({
    expiresAt: z.iso.datetime(),
    url: z.string().regex(/^\/preview\/[A-Za-z0-9_-]{43}$/),
  })
  .strict();

export const GiftPreviewLinkResponseSchema = createApiSuccessSchema(GiftPreviewLinkDtoSchema);

/** `POST /api/gifts/{publicId}/publish`: the content published is the stored revision, never a body. */
export const PublishGiftRequestSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const GiftPublicationDtoSchema = z
  .object({
    publicId: PublicGiftIdSchema,
    publishedAt: z.iso.datetime(),
    revision: z.number().int().nonnegative(),
    shareId: ShareIdSchema,
    sharePath: z.string().regex(/^\/g\/[A-Za-z0-9_-]{22}$/),
    status: z.literal("published"),
  })
  .strict();

export const GiftPublicationResponseSchema = createApiSuccessSchema(
  z.object({ publication: GiftPublicationDtoSchema }).strict(),
);

export type ClaimGiftDraftRequest = z.infer<typeof ClaimGiftDraftRequestSchema>;
export type CreateGiftPreviewRequest = z.infer<typeof CreateGiftPreviewRequestSchema>;
export type GiftPreviewLinkDto = z.infer<typeof GiftPreviewLinkDtoSchema>;
export type GiftPreviewLinkResponse = z.infer<typeof GiftPreviewLinkResponseSchema>;
export type CreateGiftDraftRequest = z.infer<typeof CreateGiftDraftRequestSchema>;
export type GiftDraftDto = z.infer<typeof GiftDraftDtoSchema>;
export type GiftPublicationSummary = z.infer<typeof GiftPublicationSummarySchema>;
export type GiftPublicationDto = z.infer<typeof GiftPublicationDtoSchema>;
export type GiftPublicationResponse = z.infer<typeof GiftPublicationResponseSchema>;
export type PublishGiftRequest = z.infer<typeof PublishGiftRequestSchema>;
export type GiftDraftResponse = z.infer<typeof GiftDraftResponseSchema>;
export type UpdateGiftDraftRequest = z.infer<typeof UpdateGiftDraftRequestSchema>;
