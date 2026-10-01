import { z } from "zod";

import {
  GiftTemplateIdSchema,
  GiftTemplateVersionSchema,
  PublicGiftIdSchema,
  ShareIdSchema,
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

export const GiftOwnershipSchema = z
  .object({
    anonymousDraftId: z.uuid().nullable(),
    claimTokenHash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]+$/)
      .nullable(),
    ownerId: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((ownership, context) => {
    const isAnonymous = ownership.ownerId === null;
    const hasAllAnonymousCredentials =
      ownership.anonymousDraftId !== null && ownership.claimTokenHash !== null;
    const hasAnyAnonymousCredential =
      ownership.anonymousDraftId !== null || ownership.claimTokenHash !== null;

    if (
      (isAnonymous && !hasAllAnonymousCredentials) ||
      (!isAnonymous && hasAnyAnonymousCredential)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Anonymous drafts require an id and claim-token hash; owned drafts require neither.",
      });
    }
  });

export const GiftSchema = z
  .object({
    access: GiftAccessPolicySchema,
    content: GiftContentSnapshotSchema,
    createdAt: z.coerce.date(),
    id: z.uuid(),
    ownership: GiftOwnershipSchema,
    publicId: PublicGiftIdSchema,
    publishedAt: z.coerce.date().optional(),
    revision: z.number().int().nonnegative(),
    shareId: ShareIdSchema.optional(),
    status: GiftStatusSchema,
    updatedAt: z.coerce.date(),
  })
  .strict()
  .superRefine((gift, context) => {
    const hasShareId = gift.shareId !== undefined;
    const hasPublishedAt = gift.publishedAt !== undefined;
    // Other statuses stay unconstrained until pause, expiry and deletion are specified.
    if (gift.status === "published" && (!hasShareId || !hasPublishedAt)) {
      context.addIssue({
        code: "custom",
        message: "A published gift requires a share id and a publication time.",
      });
    }
    if (gift.status === "draft" && (hasShareId || hasPublishedAt)) {
      context.addIssue({
        code: "custom",
        message: "A draft has no share id and no publication time.",
      });
    }
  });

export const GiftRevisionSchema = z
  .object({
    content: GiftContentSnapshotSchema,
    createdAt: z.coerce.date(),
    giftId: z.uuid(),
    revision: z.number().int().nonnegative(),
  })
  .strict();

export type Gift = z.infer<typeof GiftSchema>;
export type GiftAccessPolicy = z.infer<typeof GiftAccessPolicySchema>;
export type GiftContentSnapshot = z.infer<typeof GiftContentSnapshotSchema>;
export type GiftOwnership = z.infer<typeof GiftOwnershipSchema>;
export type GiftRevision = z.infer<typeof GiftRevisionSchema>;
