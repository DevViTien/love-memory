import { GiftTemplateIdSchema, GiftTemplateVersionSchema } from "@love-memory/domain";
import { z } from "zod";

export { PublicGiftIdSchema } from "@love-memory/domain";

export const CreateGiftDraftRequestSchema = z
  .object({
    anonymousDraftId: z.string().uuid().optional(),
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

export type CreateGiftDraftRequest = z.infer<typeof CreateGiftDraftRequestSchema>;
export type UpdateGiftDraftRequest = z.infer<typeof UpdateGiftDraftRequestSchema>;
