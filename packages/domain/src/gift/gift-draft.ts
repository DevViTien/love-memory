import { failure, type Result, success } from "@love-memory/shared";

import { GiftSchema, type Gift, type GiftContentSnapshot } from "./gift-schema";

export type GiftDraftError = Readonly<
  | { code: "GIFT_NOT_DRAFT" }
  | { actualRevision: number; code: "GIFT_REVISION_CONFLICT"; expectedRevision: number }
  | { code: "GIFT_ALREADY_CLAIMED" }
>;

export function createGiftDraft(
  input: Readonly<{
    anonymousDraftId: string | null;
    claimTokenHash: string | null;
    content: GiftContentSnapshot;
    id: string;
    now: Date;
    ownerId: string | null;
    publicId: string;
  }>,
): Gift {
  return GiftSchema.parse({
    access: { mode: "unlisted" },
    content: input.content,
    createdAt: input.now,
    id: input.id,
    ownership: {
      anonymousDraftId: input.anonymousDraftId,
      claimTokenHash: input.claimTokenHash,
      ownerId: input.ownerId,
    },
    publicId: input.publicId,
    revision: 0,
    status: "draft",
    updatedAt: input.now,
  });
}

export function updateGiftDraft(
  gift: Gift,
  input: Readonly<{
    content: GiftContentSnapshot;
    expectedRevision: number;
    now: Date;
  }>,
): Result<Gift, GiftDraftError> {
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

  return success(
    GiftSchema.parse({
      ...gift,
      content: input.content,
      revision: gift.revision + 1,
      updatedAt: input.now,
    }),
  );
}

export function claimGiftDraft(
  gift: Gift,
  input: Readonly<{ now: Date; ownerId: string }>,
): Result<Gift, GiftDraftError> {
  if (gift.status !== "draft") {
    return failure({ code: "GIFT_NOT_DRAFT" });
  }

  if (gift.ownership.ownerId !== null) {
    return failure({ code: "GIFT_ALREADY_CLAIMED" });
  }

  return success(
    GiftSchema.parse({
      ...gift,
      ownership: {
        anonymousDraftId: null,
        claimTokenHash: null,
        ownerId: input.ownerId,
      },
      updatedAt: input.now,
    }),
  );
}
