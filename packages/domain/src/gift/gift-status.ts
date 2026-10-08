import { failure, type Result, success } from "@love-memory/shared";
import { z } from "zod";

export const GIFT_STATUSES = [
  "draft",
  "publishing",
  "scheduled",
  "published",
  "paused",
  "expired",
  "deleting",
  "deleted",
] as const;

export const GiftStatusSchema = z.enum(GIFT_STATUSES);
export type GiftStatus = z.infer<typeof GiftStatusSchema>;

/**
 * The statuses whose content its owner can still edit: a draft, or the working copy of a published
 * gift. Recipients of a published gift see its current publication, never this content.
 */
export const EDITABLE_GIFT_STATUSES = [
  "draft",
  "published",
] as const satisfies readonly GiftStatus[];
export type EditableGiftStatus = (typeof EDITABLE_GIFT_STATUSES)[number];

export function isEditableGiftStatus(status: GiftStatus): status is EditableGiftStatus {
  return (EDITABLE_GIFT_STATUSES as readonly GiftStatus[]).includes(status);
}

export const GIFT_TRANSITIONS = {
  deleted: [],
  deleting: ["deleted"],
  draft: ["publishing", "deleting"],
  expired: ["publishing", "deleting"],
  paused: ["published", "scheduled", "deleting"],
  published: ["publishing", "paused", "expired", "deleting"],
  publishing: ["published", "scheduled", "draft"],
  scheduled: ["published", "paused", "expired", "deleting"],
} as const satisfies Record<GiftStatus, readonly GiftStatus[]>;

export type GiftTransitionError = Readonly<{
  code: "INVALID_GIFT_TRANSITION";
  from: GiftStatus;
  to: GiftStatus;
}>;

export function canTransitionGift(from: GiftStatus, to: GiftStatus): boolean {
  return (GIFT_TRANSITIONS[from] as readonly GiftStatus[]).includes(to);
}

export function transitionGift(
  from: GiftStatus,
  to: GiftStatus,
): Result<GiftStatus, GiftTransitionError> {
  if (canTransitionGift(from, to)) {
    return success(to);
  }

  return failure({
    code: "INVALID_GIFT_TRANSITION",
    from,
    to,
  });
}
