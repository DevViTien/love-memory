import { describe, expect, it, vi } from "vitest";

import {
  createTemplateBridge,
  readTrustedTemplateEvent,
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
