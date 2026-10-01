import { describe, expect, it, vi } from "vitest";

import {
  createTemplateBridge,
  readTrustedTemplateEvent,
  TEMPLATE_ISSUE_CODES,
  TEMPLATE_MESSAGE_PROTOCOL_VERSION,
  TemplateEventSchema,
  TemplateHostMessageSchema,
} from "./messages";

describe("template message protocol", () => {
  it("validates the host and template message discriminators", () => {
    expect(
      TemplateHostMessageSchema.safeParse({
        context: { locale: "vi-VN", prefersReducedMotion: false },
        payload: { title: "Ká»· niá»‡m cá»§a chÃºng ta" },
        protocolVersion: TEMPLATE_MESSAGE_PROTOCOL_VERSION,
        type: "INIT",
      }).success,
    ).toBe(true);
    expect(TemplateEventSchema.safeParse({ type: "COMPLETE" }).success).toBe(true);
    expect(TemplateEventSchema.safeParse({ privateData: "x", type: "COMPLETE" }).success).toBe(
      false,
    );
  });

  it("accepts messages only from the expected sandbox window", () => {
    const expectedSource = {} as MessageEventSource;
    const otherSource = {} as MessageEventSource;
    const data = { protocolVersion: TEMPLATE_MESSAGE_PROTOCOL_VERSION, type: "READY" };

    expect(
      readTrustedTemplateEvent(
        { data, source: expectedSource } as MessageEvent<unknown>,
        expectedSource,
      ),
    ).toEqual(data);
    expect(
      readTrustedTemplateEvent(
        { data, source: otherSource } as MessageEvent<unknown>,
        expectedSource,
      ),
    ).toBeUndefined();
  });

  it("owns subscription cleanup and runtime lifecycle commands", () => {
    const events: string[] = [];
    const unsubscribe = vi.fn();
    const postMessage = vi.fn();
    const bridge = createTemplateBridge({
      onEvent: (event) => events.push(event.type),
      postMessage,
      subscribe: (listener) => {
        listener({ protocolVersion: TEMPLATE_MESSAGE_PROTOCOL_VERSION, type: "READY" });
        return unsubscribe;
      },
    });

    bridge.start();
    bridge.start();
    bridge.disconnect();
    bridge.start();
    bridge.initialize({ title: "Memory" }, true);
    bridge.play();
    bridge.pause();
    bridge.destroy();

    expect(events).toEqual(["READY", "READY"]);
    expect(postMessage).toHaveBeenCalledTimes(4);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        assets: {},
        protocolVersion: TEMPLATE_MESSAGE_PROTOCOL_VERSION,
        type: "INIT",
      }),
    );
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
});

describe("template ISSUE event", () => {
  const issue = {
    code: "ASSET_UNAVAILABLE",
    fieldId: "memories",
    itemIndex: 1,
    protocolVersion: TEMPLATE_MESSAGE_PROTOCOL_VERSION,
    type: "ISSUE",
  } as const;

  it("accepts a valid issue with and without an item index", () => {
    expect(TemplateEventSchema.parse(issue)).toEqual(issue);
    expect(
      TemplateEventSchema.safeParse({
        code: "CONTENT_MISSING",
        fieldId: "final-letter",
        protocolVersion: TEMPLATE_MESSAGE_PROTOCOL_VERSION,
        type: "ISSUE",
      }).success,
    ).toBe(true);
    expect(TEMPLATE_ISSUE_CODES).toEqual(["ASSET_UNAVAILABLE", "CONTENT_MISSING"]);
  });

  it.each([
    ["an unknown code", { ...issue, code: "BROKEN" }],
    ["a negative item index", { ...issue, itemIndex: -1 }],
    ["a fractional item index", { ...issue, itemIndex: 1.5 }],
    ["an item index above 29", { ...issue, itemIndex: 30 }],
    ["an uppercase field id", { ...issue, fieldId: "Memories" }],
    ["an empty field id", { ...issue, fieldId: "" }],
    ["a field id longer than 80 characters", { ...issue, fieldId: "a".repeat(81) }],
    ["a missing protocol version", { code: issue.code, fieldId: issue.fieldId, type: "ISSUE" }],
    ["a wrong protocol version", { ...issue, protocolVersion: 2 }],
    ["an extra property", { ...issue, caption: "Đà Lạt" }],
  ])("rejects an issue with %s", (_case, data) => {
    expect(TemplateEventSchema.safeParse(data).success).toBe(false);
  });

  it("ignores an issue from another window", () => {
    const expectedSource = {} as MessageEventSource;

    expect(
      readTrustedTemplateEvent(
        { data: issue, source: expectedSource } as MessageEvent<unknown>,
        expectedSource,
      ),
    ).toEqual(issue);
    expect(
      readTrustedTemplateEvent(
        { data: issue, source: {} as MessageEventSource } as MessageEvent<unknown>,
        expectedSource,
      ),
    ).toBeUndefined();
  });
});
