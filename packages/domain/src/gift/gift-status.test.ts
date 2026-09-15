import { describe, expect, it } from "vitest";

import { canTransitionGift, GIFT_TRANSITIONS, transitionGift } from "./gift-status";

describe("gift lifecycle", () => {
  it("allows the supported publish path", () => {
    expect(canTransitionGift("draft", "publishing")).toBe(true);
    expect(canTransitionGift("publishing", "published")).toBe(true);
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
});
