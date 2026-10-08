import { z } from "zod";

import {
  GiftTemplateIdSchema,
  GiftTemplateVersionSchema,
  PublicGiftIdSchema,
  ShareIdSchema,
} from "./gift-identity";
import { entitlementExpiry, GiftEntitlementSchema } from "../billing/gift-entitlement";
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
    /** The plan values granted at the first publish (`gift-plans`); a draft has none. */
    entitlement: GiftEntitlementSchema.optional(),
    /** The end of the share link: the entitlement's `grantedAt` plus its `retentionDays`. */
    expiresAt: z.coerce.date().optional(),
    id: z.uuid(),
    ownership: GiftOwnershipSchema,
    publicId: PublicGiftIdSchema,
    publishedAt: z.coerce.date().optional(),
    /** The revision of the current publication, the one recipients receive. */
    publishedRevision: z.number().int().nonnegative().optional(),
    revision: z.number().int().nonnegative(),
    shareId: ShareIdSchema.optional(),
    status: GiftStatusSchema,
    updatedAt: z.coerce.date(),
  })
  .strict()
  .superRefine((gift, context) => {
    const hasShareId = gift.shareId !== undefined;
    const hasPublishedAt = gift.publishedAt !== undefined;
    const hasPublishedRevision = gift.publishedRevision !== undefined;
    // Other statuses stay unconstrained until pause, expiry and deletion are specified.
    if (gift.status === "published" && (!hasShareId || !hasPublishedAt || !hasPublishedRevision)) {
      context.addIssue({
        code: "custom",
        message: "A published gift requires a share id, a publication time and revision.",
      });
    }
    // The working copy only moves forward from the publication it started from.
    if (hasPublishedRevision && gift.publishedRevision! > gift.revision) {
      context.addIssue({
        code: "custom",
        message: "The published revision cannot be newer than the gift's revision.",
        path: ["publishedRevision"],
      });
    }
    if (gift.status === "draft" && (hasShareId || hasPublishedAt || hasPublishedRevision)) {
      context.addIssue({
        code: "custom",
        message: "A draft has no share id, no publication time and no published revision.",
      });
    }
    const hasEntitlement = gift.entitlement !== undefined;
    const hasExpiresAt = gift.expiresAt !== undefined;
    if (gift.status === "published" && (!hasEntitlement || !hasExpiresAt)) {
      context.addIssue({
        code: "custom",
        message: "A published gift requires an entitlement and an expiry.",
      });
    }
    if (gift.status === "draft" && (hasEntitlement || hasExpiresAt)) {
      context.addIssue({
        code: "custom",
        message: "A draft has no entitlement and no expiry.",
      });
    }
    if (
      hasEntitlement !== hasExpiresAt ||
      (gift.entitlement &&
        gift.expiresAt &&
        entitlementExpiry(gift.entitlement).getTime() !== gift.expiresAt.getTime())
    ) {
      context.addIssue({
        code: "custom",
        message: "The expiry must be the entitlement's grant time plus its retention.",
        path: ["expiresAt"],
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
