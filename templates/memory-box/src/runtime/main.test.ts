import type { TemplateEvent } from "@love-memory/template-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initMessage } from "../test/harness";
import { startMemoryBox } from "./main";

let posted: TemplateEvent[];

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  posted = [];
  vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
    posted.push(message as TemplateEvent);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function fromParent(data: unknown, source: MessageEventSource | null = window.parent) {
  window.dispatchEvent(new MessageEvent("message", { data, source }));
}

describe("startMemoryBox", () => {
  it("handles messages from the parent window only, until DESTROY", () => {
    const controller = startMemoryBox(window);

    fromParent(initMessage(), null);
    expect(posted).toEqual([]);
    fromParent(initMessage());
    expect(posted).toEqual([{ protocolVersion: 1, type: "READY" }]);
    fromParent({ type: "DESTROY" });
    fromParent(initMessage());

    expect(posted).toHaveLength(1);
    expect(controller.state()).toBe("destroyed");
  });

  it("turns an uncaught error or rejection into the runtime-error fallback", () => {
    const controller = startMemoryBox(window);
    fromParent(initMessage());

    window.dispatchEvent(new ErrorEvent("error", { error: new Error("uncaught") }));
    window.dispatchEvent(new Event("unhandledrejection"));

    expect(controller.state()).toBe("failed");
    expect(posted).toEqual([
      { protocolVersion: 1, type: "READY" },
      { code: "RUNTIME_ERROR", type: "ERROR" },
    ]);
    expect(document.querySelector(".fallback h1")?.textContent).toBe("Gửi An");
    fromParent({ type: "DESTROY" });
  });

  it("drives scenes with the window timers", () => {
    vi.useFakeTimers();
    const controller = startMemoryBox(window);
    fromParent(initMessage());
    fromParent({ type: "PLAY" });
    vi.advanceTimersByTime(2000);
    fromParent({ type: "PAUSE" });
    fromParent({ type: "PLAY" });
    vi.advanceTimersByTime(3000);

    expect(posted.filter((event) => event.type === "SCENE")).toEqual([
      { sceneId: "opening", type: "SCENE" },
      { sceneId: "memory-1", type: "SCENE" },
    ]);
    fromParent({ type: "DESTROY" });
    expect(controller.state()).toBe("destroyed");
    vi.useRealTimers();
  });
});
