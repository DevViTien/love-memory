import { describe, expect, it } from "vitest";

import {
  ANALYTICS_EVENT_NAMES,
  AnalyticsContextSchema,
  AnalyticsEventRequestSchema,
  CLIENT_ANALYTICS_EVENT_NAMES,
} from "./analytics";

const giftRef = "A".repeat(42) + "_";
const base = {
  giftRef,
  sessionId: "9c1b2f0e-6a7d-4c90-8d7a-4a559c1b2f0e",
  templateId: "memory-box",
  templateVersion: "1.1.0",
} as const;

function issuePaths(input: unknown): string[] {
  const parsed = AnalyticsEventRequestSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
}

describe("analytics event contract", () => {
  it("lists eight names, and the client names without gift_published", () => {
    expect(ANALYTICS_EVENT_NAMES).toHaveLength(8);
    expect(CLIENT_ANALYTICS_EVENT_NAMES).toHaveLength(7);
    expect(CLIENT_ANALYTICS_EVENT_NAMES).not.toContain("gift_published");
  });

  it.each(CLIENT_ANALYTICS_EVENT_NAMES.filter((name) => name !== "scene_completed"))(
    "accepts the client event %s",
    (name) => {
      expect(AnalyticsEventRequestSchema.parse({ ...base, name })).toEqual({ ...base, name });
    },
  );

  it("accepts scene_completed with a kebab-case scene id", () => {
    const event = { ...base, name: "scene_completed", sceneId: "memory-1" };
    expect(AnalyticsEventRequestSchema.parse(event)).toEqual(event);
  });

  it.each(["gift_published", "gift_viewed"])("rejects the name %s", (name) => {
    expect(issuePaths({ ...base, name })).toContain("name");
  });

  it.each([{ receiverName: "Minh Thư" }, { shareId: "AbCdEfGhIjKlMnOpQrStUv" }])(
    "rejects the extra key %o",
    (extra) => {
      expect(
        AnalyticsEventRequestSchema.safeParse({ ...base, name: "gift_completed", ...extra })
          .success,
      ).toBe(false);
    },
  );

  it("requires sceneId for scene_completed and forbids it elsewhere, on the sceneId path", () => {
    expect(issuePaths({ ...base, name: "scene_completed" })).toEqual(["sceneId"]);
    expect(issuePaths({ ...base, name: "gift_completed", sceneId: "letter" })).toEqual(["sceneId"]);
    expect(issuePaths({ ...base, name: "scene_completed", sceneId: "Memory 1" })).toEqual([
      "sceneId",
    ]);
  });

  it.each([
    ["sessionId", { sessionId: "not-a-uuid" }],
    ["giftRef", { giftRef: "A".repeat(42) }],
    ["giftRef", { giftRef: "A".repeat(44) }],
    ["giftRef", { giftRef: `${"A".repeat(42)}=` }],
    ["templateId", { templateId: "Memory-Box" }],
    ["templateVersion", { templateVersion: "1.1" }],
    ["templateVersion", { templateVersion: `1.0.0-${"a".repeat(60)}` }],
  ])("rejects a malformed %s", (path, override) => {
    expect(issuePaths({ ...base, name: "gift_completed", ...override })).toContain(path);
  });

  it("validates the page analytics context strictly", () => {
    const context = { giftRef, templateId: "memory-box", templateVersion: "1.1.0" };
    expect(AnalyticsContextSchema.parse(context)).toEqual(context);
    expect(AnalyticsContextSchema.safeParse({ ...context, shareId: "x" }).success).toBe(false);
    expect(AnalyticsContextSchema.safeParse({ ...context, giftRef: "short" }).success).toBe(false);
  });
});
