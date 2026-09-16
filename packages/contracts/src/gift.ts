import {
  GiftTemplateIdSchema,
  GiftTemplateVersionSchema,
  PublicGiftIdSchema,
} from "@love-memory/domain";
import { z } from "zod";

export { PublicGiftIdSchema };

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

export const GiftDraftDtoSchema = z
  .object({
    content: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime(),
    ownerKind: z.enum(["anonymous", "user"]),
    publicId: PublicGiftIdSchema,
    revision: z.number().int().nonnegative(),
    status: z.literal("draft"),
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

export type ClaimGiftDraftRequest = z.infer<typeof ClaimGiftDraftRequestSchema>;
export type CreateGiftDraftRequest = z.infer<typeof CreateGiftDraftRequestSchema>;
export type GiftDraftDto = z.infer<typeof GiftDraftDtoSchema>;
export type GiftDraftResponse = z.infer<typeof GiftDraftResponseSchema>;
export type UpdateGiftDraftRequest = z.infer<typeof UpdateGiftDraftRequestSchema>;
