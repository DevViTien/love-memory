import { failure, type Result, success } from "@love-memory/shared";
import { z } from "zod";

import { type GiftDraftError } from "./gift-draft";
import { GiftTemplateIdSchema, GiftTemplateVersionSchema, ShareIdSchema } from "./gift-identity";
import { GiftSchema, type Gift } from "./gift-schema";
import { transitionGift, type GiftTransitionError } from "./gift-status";

/** The most asset ids one publication can hold: the per-gift asset quota. */
export const GIFT_PUBLICATION_MAX_ASSETS = 30;

/**
 * The immutable record of one publish: the exact template version, the artifact bytes it pinned
 * and the content snapshot. No API ever updates or deletes it.
 */
export const GiftPublicationSchema = z
  .object({
    artifactContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    assetIds: z
      .array(z.uuid())
      .max(GIFT_PUBLICATION_MAX_ASSETS)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Asset ids must be unique.",
      }),
    audioTrackId: z.string().min(1).nullable(),
    content: z.record(z.string(), z.unknown()),
    createdAt: z.coerce.date(),
    giftId: z.uuid(),
    id: z.uuid(),
    publishedAt: z.coerce.date(),
    revision: z.number().int().nonnegative(),
    shareId: ShareIdSchema,
    templateId: GiftTemplateIdSchema,
    templateVersion: GiftTemplateVersionSchema,
  })
  .strict();

export type GiftPublication = z.infer<typeof GiftPublicationSchema>;

export type GiftPublishError = GiftDraftError | GiftTransitionError;

export type GiftRepublishError =
  | Readonly<{ code: "GIFT_NOT_PUBLISHED" }>
  | Readonly<{ code: "GIFT_NO_UNPUBLISHED_CHANGES" }>
  | Extract<GiftDraftError, { code: "GIFT_REVISION_CONFLICT" }>
  | GiftTransitionError;

/**
 * Moves a draft `draft → publishing → published` in memory. Only the final state is persisted;
 * `publishing` exists so a later payment or outbox step can sit between the two transitions.
 */
export function publishGiftDraft(
  gift: Gift,
  input: Readonly<{ expectedRevision: number; now: Date; shareId: string }>,
): Result<Gift, GiftPublishError> {
  if (gift.status !== "draft") {
    return failure({ code: "GIFT_NOT_DRAFT" });
  }

  if (gift.revision !== input.expectedRevision) {
    return failure({
      actualRevision: gift.revision,
      code: "GIFT_REVISION_CONFLICT",
      expectedRevision: input.expectedRevision,
    });
  }

  if (gift.ownership.ownerId === null) {
    return failure({ code: "GIFT_NOT_OWNED" });
  }

  const publishing = transitionGift(gift.status, "publishing");
  if (!publishing.ok) return publishing;
  const published = transitionGift(publishing.data, "published");
  if (!published.ok) return published;

  return success(
    GiftSchema.parse({
      ...gift,
      publishedAt: input.now,
      publishedRevision: gift.revision,
      shareId: input.shareId,
      status: published.data,
      updatedAt: input.now,
    }),
  );
}

/**
 * Publishes the working copy of a published gift as its new current publication, `published →
 * publishing → published` in memory. The share id stays, so the recipient link never changes;
 * only a revision newer than the current publication can be published.
 */
export function republishGift(
  gift: Gift,
  input: Readonly<{ expectedRevision: number; now: Date }>,
): Result<Gift, GiftRepublishError> {
  if (gift.status !== "published" || gift.publishedRevision === undefined) {
    return failure({ code: "GIFT_NOT_PUBLISHED" });
  }

  if (gift.revision !== input.expectedRevision) {
    return failure({
      actualRevision: gift.revision,
      code: "GIFT_REVISION_CONFLICT",
      expectedRevision: input.expectedRevision,
    });
  }

  if (input.expectedRevision <= gift.publishedRevision) {
    return failure({ code: "GIFT_NO_UNPUBLISHED_CHANGES" });
  }

  const publishing = transitionGift(gift.status, "publishing");
  if (!publishing.ok) return publishing;
  const published = transitionGift(publishing.data, "published");
  if (!published.ok) return published;

  return success(
    GiftSchema.parse({
      ...gift,
      publishedAt: input.now,
      publishedRevision: gift.revision,
      status: published.data,
      updatedAt: input.now,
    }),
  );
}

/**
 * The snapshot of a published gift. Everything it shares with the gift is copied from the gift, so
 * the two can never disagree.
 */
export function createGiftPublication(
  input: Readonly<{
    artifactContentHash: string;
    assetIds: readonly string[];
    audioTrackId: string | null;
    gift: Gift;
    id: string;
  }>,
): GiftPublication {
  const { gift } = input;
  if (gift.status !== "published" || !gift.shareId || !gift.publishedAt) {
    throw new Error("Only a published gift can be snapshotted.");
  }

  return GiftPublicationSchema.parse({
    artifactContentHash: input.artifactContentHash,
    assetIds: [...input.assetIds],
    audioTrackId: input.audioTrackId,
    content: gift.content.data,
    createdAt: gift.publishedAt,
    giftId: gift.id,
    id: input.id,
    publishedAt: gift.publishedAt,
    revision: gift.revision,
    shareId: gift.shareId,
    templateId: gift.content.templateId,
    templateVersion: gift.content.templateVersion,
  });
}
