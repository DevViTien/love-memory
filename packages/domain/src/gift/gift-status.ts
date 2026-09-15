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

export const GIFT_TRANSITIONS = {
  deleted: [],
  deleting: ["deleted"],
  draft: ["publishing", "deleting"],
  expired: ["publishing", "deleting"],
  paused: ["published", "scheduled", "deleting"],
  published: ["paused", "expired", "deleting"],
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
