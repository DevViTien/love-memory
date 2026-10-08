import {
  GiftTemplateIdSchema,
  GiftTemplateVersionSchema,
  PlanIdSchema,
  PublicGiftIdSchema,
  ShareIdSchema,
} from "@love-memory/domain";
import { z } from "zod";

import { createApiSuccessSchema } from "./api";

export { PlanIdSchema, PublicGiftIdSchema, ShareIdSchema };

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

/**
 * The owner's summary of a published gift's current publication, what recipients receive, and the
 * entitlement values the Studio needs. Never the grant source or the price.
 */
export const GiftPublicationSummarySchema = z
  .object({
    expiresAt: z.iso.datetime(),
    maxPhotos: z.number().int().positive().nullable(),
    planId: PlanIdSchema,
    publishedAt: z.iso.datetime(),
    revision: z.number().int().nonnegative(),
    shareId: ShareIdSchema,
    sharePath: z.string().regex(/^\/g\/[A-Za-z0-9_-]{22}$/),
    watermark: z.boolean(),
  })
  .strict();

/**
 * A plan as the Studio offers it for a first publish, rendered into the page by the server so the
 * browser never holds a plan constant. `internalGrant`: available through the internal grant.
 */
export const PlanOfferDtoSchema = z
  .object({
    available: z.boolean(),
    internalGrant: z.boolean(),
    maxPhotos: z.number().int().positive().nullable(),
    name: z.string().min(1),
    planId: PlanIdSchema,
    planVersion: z.number().int().positive(),
    priceVnd: z.number().int().nonnegative(),
    retentionDays: z.number().int().positive(),
    watermark: z.boolean(),
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
    planId: PlanIdSchema,
  })
  .strict();

export const GiftPublicationDtoSchema = z
  .object({
    expiresAt: z.iso.datetime(),
    planId: PlanIdSchema,
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
export type PlanOfferDto = z.infer<typeof PlanOfferDtoSchema>;
export type PublishGiftRequest = z.infer<typeof PublishGiftRequestSchema>;
export type GiftDraftResponse = z.infer<typeof GiftDraftResponseSchema>;
export type UpdateGiftDraftRequest = z.infer<typeof UpdateGiftDraftRequestSchema>;
