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

/** A share link credential: 16 random bytes as unpadded base64url. */
export const ShareIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/, {
  message: "Share id must be 22 base64url characters.",
});

export type ShareId = z.infer<typeof ShareIdSchema>;
