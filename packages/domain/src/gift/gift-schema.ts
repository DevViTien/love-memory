import { z } from "zod";

import {
  GiftTemplateIdSchema,
  GiftTemplateVersionSchema,
  PublicGiftIdSchema,
} from "./gift-identity";
import { GiftStatusSchema } from "./gift-status";

export const GiftAccessPolicySchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("unlisted"),
    })
    .strict(),
  z
    .object({
      mode: z.literal("password"),
      passwordHash: z.string().min(20),
    })
    .strict(),
  z
    .object({
      mode: z.literal("scheduled"),
      unlockAt: z.coerce.date(),
    })
    .strict(),
]);

export const GiftContentSnapshotSchema = z
  .object({
    data: z.record(z.string(), z.unknown()),
    schemaVersion: z.number().int().positive(),
    templateId: GiftTemplateIdSchema,
    templateVersion: GiftTemplateVersionSchema,
  })
  .strict();

export const GiftSchema = z
  .object({
    access: GiftAccessPolicySchema,
    content: GiftContentSnapshotSchema,
    ownerId: z.string().min(1),
    publicId: PublicGiftIdSchema,
    revision: z.number().int().nonnegative(),
    status: GiftStatusSchema,
  })
  .strict();

export type Gift = z.infer<typeof GiftSchema>;
export type GiftAccessPolicy = z.infer<typeof GiftAccessPolicySchema>;
export type GiftContentSnapshot = z.infer<typeof GiftContentSnapshotSchema>;
