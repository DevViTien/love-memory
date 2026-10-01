import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { completePayload, createHarness, initMessage, stageScene } from "../test/harness";
import { createErrorBoundary, FATAL_MESSAGE, renderStaticFallback } from "./fallback";
import type { MemoryBoxView } from "./render";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function throwOnScene(sceneId: string) {
  return (view: MemoryBoxView): MemoryBoxView => ({
    ...view,
    renderScene: (scene, content, options) => {
      if (scene.id === sceneId) throw new Error("render failed");
      view.renderScene(scene, content, options);
    },
  });
}

describe("runtime error fallback", () => {
  it("shows all gift text statically and sends RUNTIME_ERROR once when a scene throws", () => {
    const harness = createHarness(throwOnScene("memory-2"));
    harness.send(initMessage());
    harness.send({ type: "PLAY" });
    harness.next();

    harness.next();

    const fallback = document.querySelector(".fallback");
    expect(fallback?.querySelector("h1")?.textContent).toBe("Gửi An");
    expect([...(fallback?.children ?? [])].map((node) => node.textContent)).toEqual([
      "Gửi An",
      "15/09/2024",
      "Mở hộp nhé!",
      "Đà Lạt 2023 🌲Bữa tối đầu tiên",
      "Đoạn một của lá thư.",
      "Đoạn hai của lá thư.",
    ]);
    expect(fallback?.querySelectorAll("img")).toHaveLength(0);
    expect(document.body.dataset["state"]).toBe("failed");

    vi.advanceTimersByTime(60_000);
    harness.send({ type: "PLAY" });
    harness.send({ type: "PAUSE" });
    expect(harness.scenes()).toEqual(["opening", "memory-1"]);
    expect(harness.events.filter((event) => event.type === "ERROR")).toEqual([
      { code: "RUNTIME_ERROR", type: "ERROR" },
    ]);
    expect(harness.eventTypes()).not.toContain("COMPLETE");
  });

  it("recovers from the cover on a later INIT", () => {
    const harness = createHarness(throwOnScene("memory-2"));
    harness.send(initMessage());
    harness.send({ type: "PLAY" });
    harness.next();
    harness.next();

    harness.send(initMessage());

    expect(harness.controller.state()).toBe("cover");
    expect(stageScene()).toBe("cover");
    expect(harness.eventTypes().at(-1)).toBe("READY");
  });

  it("shows a fixed sentence when the fallback renderer also throws", () => {
    const harness = createHarness((view) => ({
      ...throwOnScene("opening")(view),
      renderFallback: () => {
        throw new Error("fallback failed");
      },
    }));
    harness.send(initMessage());

    harness.send({ type: "PLAY" });

    expect(document.getElementById("app")?.textContent).toBe(FATAL_MESSAGE);
    expect(harness.eventTypes()).toEqual(["READY", "ERROR"]);
  });

  it("still sends RUNTIME_ERROR when nothing can render", () => {
    const harness = createHarness((view) => ({
      ...throwOnScene("opening")(view),
      renderFallback: () => {
        throw new Error("fallback failed");
      },
      renderFatal: () => {
        throw new Error("fatal failed");
      },
      setState: (state) => {
        if (state === "failed") throw new Error("state failed");
        view.setState(state);
      },
    }));
    harness.send(initMessage());

    harness.send({ type: "PLAY" });

    expect(harness.eventTypes()).toEqual(["READY", "ERROR"]);
    expect(harness.controller.state()).toBe("failed");
  });

  it("uses the fixed sentence for a failure before any INIT", () => {
    const harness = createHarness();

    harness.controller.fail(new Error("boom"));
    harness.controller.fail(new Error("again"));

    expect(document.getElementById("app")?.textContent).toBe(FATAL_MESSAGE);
    expect(harness.events).toEqual([{ code: "RUNTIME_ERROR", type: "ERROR" }]);
  });

  it("renders only the text that exists", () => {
    const root = document.createElement("main");

    renderStaticFallback(root, {
      memories: [{ index: 0, label: "Kỷ niệm 1" }],
      theme: "rose-night",
    });

    expect([...root.querySelectorAll(".fallback > *")].map((node) => node.textContent)).toEqual([
      "Gửi bạn",
    ]);
  });

  it("routes errors thrown by a guarded callback to the failure path", () => {
    const onFailure = vi.fn();
    const error = new Error("x");
    const { guard } = createErrorBoundary(onFailure);

    guard(() => {
      throw error;
    })();
    guard((value: number) => expect(value).toBe(1))(1);

    expect(onFailure).toHaveBeenCalledExactlyOnceWith(error);
  });

  it("keeps the fallback for a complete payload readable without a date", () => {
    const harness = createHarness(throwOnScene("opening"));
    const payload: Record<string, unknown> = completePayload();
    delete payload["anniversary-date"];
    harness.send(initMessage(payload));
    harness.send({ type: "PLAY" });

    expect(document.querySelector(".fallback .date")).toBeNull();
    expect(document.querySelectorAll(".fallback .captions li")).toHaveLength(2);
  });
});
