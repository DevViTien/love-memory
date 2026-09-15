import { SemanticVersionSchema, SlugSchema } from "@love-memory/shared";
import { z } from "zod";

export const GIFT_LIMITS = {
  publicIdMaxLength: 64,
  publicIdMinLength: 16,
  templateIdMaxLength: 80,
  templateIdMinLength: 3,
} as const;

export const PublicGiftIdSchema = z
  .string()
  .min(GIFT_LIMITS.publicIdMinLength)
  .max(GIFT_LIMITS.publicIdMaxLength)
  .regex(/^[A-Za-z0-9_-]+$/, {
    message: "Gift public id contains unsupported characters.",
  });

export const GiftTemplateIdSchema = SlugSchema.min(GIFT_LIMITS.templateIdMinLength).max(
  GIFT_LIMITS.templateIdMaxLength,
);

export const GiftTemplateVersionSchema = SemanticVersionSchema;

export type PublicGiftId = z.infer<typeof PublicGiftIdSchema>;
