import { describe, expect, it } from "vitest";

import {
  canTransitionGift,
  EDITABLE_GIFT_STATUSES,
  GIFT_TRANSITIONS,
  isEditableGiftStatus,
  transitionGift,
} from "./gift-status";

describe("gift lifecycle", () => {
  it("allows the supported publish path", () => {
    expect(canTransitionGift("draft", "publishing")).toBe(true);
    expect(canTransitionGift("publishing", "published")).toBe(true);
  });

  it("lets a published gift publish a newer revision through publishing", () => {
    expect(transitionGift("published", "publishing")).toEqual({ data: "publishing", ok: true });
  });

  it("treats drafts and published gifts as editable, and nothing else", () => {
    expect(EDITABLE_GIFT_STATUSES).toEqual(["draft", "published"]);
    expect(isEditableGiftStatus("published")).toBe(true);
    expect(isEditableGiftStatus("paused")).toBe(false);
    expect(isEditableGiftStatus("deleted")).toBe(false);
  });

  it("rejects transitions out of deleted", () => {
    expect(GIFT_TRANSITIONS.deleted).toHaveLength(0);
    expect(transitionGift("deleted", "published")).toEqual({
      error: {
        code: "INVALID_GIFT_TRANSITION",
        from: "deleted",
        to: "published",
      },
      ok: false,
    });
  });

  it("returns the next state for a valid transition", () => {
    expect(transitionGift("scheduled", "published")).toEqual({
      data: "published",
      ok: true,
    });
  });

  it.each([
    ["draft", "published"],
    ["published", "published"],
    ["publishing", "publishing"],
    ["deleted", "publishing"],
  ] as const)("refuses %s -> %s", (from, to) => {
    expect(transitionGift(from, to)).toEqual({
      error: { code: "INVALID_GIFT_TRANSITION", from, to },
      ok: false,
    });
  });
});
