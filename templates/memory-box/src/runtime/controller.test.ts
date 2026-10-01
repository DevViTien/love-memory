import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ASSET_IDS,
  ASSET_URLS,
  completePayload,
  createHarness,
  initMessage,
  stageScene,
} from "../test/harness";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const fullSequence = ["opening", "memory-1", "memory-2", "memory-3", "letter", "finale"];

describe("initialization and cover", () => {
  it("shows a neutral loading state until INIT", () => {
    const harness = createHarness();

    expect(document.body.dataset["state"]).toBe("loading");
    expect(document.body.textContent).toContain("Đang mở món quà…");
    expect(harness.events).toEqual([]);
  });

  it("renders the cover after INIT and sends READY without a SCENE", () => {
    const harness = createHarness();

    harness.send(initMessage());

    expect(harness.events).toEqual([{ protocolVersion: 1, type: "READY" }]);
    expect(document.querySelector("h1")?.textContent).toBe("Gửi An");
    expect(document.querySelector(".date")?.textContent).toBe("15/09/2024");
    expect(document.querySelector(".box")).not.toBeNull();
    expect(stageScene()).toBe("cover");
    expect(document.querySelector("button")).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(harness.scenes()).toEqual([]);
  });

  it("returns to the cover for a different INIT during playback", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PLAY" });
    harness.next();
    harness.next();
    expect(stageScene()).toBe("memory-2");

    harness.send(initMessage(completePayload(), { reducedMotion: true }));

    expect(harness.controller.state()).toBe("cover");
    expect(stageScene()).toBe("cover");
    expect(harness.eventTypes().at(-1)).toBe("READY");
    vi.advanceTimersByTime(60_000);
    expect(harness.scenes()).toEqual(["opening", "memory-1", "memory-2"]);
  });

  it("answers an identical INIT with READY only", () => {
    const harness = createHarness();
    const payload = completePayload({
      memories: [
        { assetId: ASSET_IDS[0] },
        { assetId: "550e8400-e29b-41d4-a716-000000000001" },
        { assetId: "550e8400-e29b-41d4-a716-000000000002" },
      ],
    });
    harness.send(initMessage(payload));
    harness.send({ type: "PLAY" });
    harness.next();
    expect(harness.eventTypes()).toEqual(["READY", "ISSUE", "ISSUE", "SCENE", "SCENE"]);

    harness.send(initMessage(JSON.parse(JSON.stringify(payload)) as typeof payload));

    expect(harness.eventTypes()).toEqual(["READY", "ISSUE", "ISSUE", "SCENE", "SCENE", "READY"]);
    expect(harness.controller.state()).toBe("playing");
    expect(stageScene()).toBe("memory-1");
  });

  it("answers a malformed INIT with INVALID_MESSAGE and keeps its state", () => {
    const harness = createHarness();
    harness.send({ ...initMessage(), context: undefined });
    expect(harness.events).toEqual([{ code: "INVALID_MESSAGE", type: "ERROR" }]);
    expect(harness.controller.state()).toBe("loading");

    harness.send(initMessage());
    harness.send({ ...initMessage(), protocolVersion: 2 });

    expect(harness.eventTypes()).toEqual(["ERROR", "READY", "ERROR"]);
    expect(harness.controller.state()).toBe("cover");
    expect(stageScene()).toBe("cover");
  });

  it("ignores messages that are not host messages", () => {
    const harness = createHarness();

    harness.send({ type: "SEEK" });
    harness.send({ type: "PLAY", extra: 1 });
    harness.send("PLAY");

    expect(harness.events).toEqual([]);
  });

  it("holds a PLAY that arrives before the first INIT", () => {
    const harness = createHarness();

    harness.send({ type: "PLAY" });
    expect(harness.events).toEqual([]);
    harness.send(initMessage());

    expect(harness.events).toEqual([
      { protocolVersion: 1, type: "READY" },
      { sceneId: "opening", type: "SCENE" },
    ]);
  });

  it("drops a held PLAY when PAUSE follows before INIT", () => {
    const harness = createHarness();

    harness.send({ type: "PLAY" });
    harness.send({ type: "PAUSE" });
    harness.send(initMessage());

    expect(harness.eventTypes()).toEqual(["READY"]);
    expect(harness.controller.state()).toBe("cover");
  });
});

describe("scene sequence", () => {
  it("plays every scene in order with Tiếp and completes once", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PLAY" });

    for (const scene of fullSequence.slice(0, -1)) {
      expect(stageScene()).toBe(scene);
      harness.next();
    }
    expect(stageScene()).toBe("finale");
    expect(document.querySelector("button.next")).toBeNull();
    vi.advanceTimersByTime(1199);
    expect(harness.eventTypes()).not.toContain("COMPLETE");
    vi.advanceTimersByTime(1);

    expect(harness.scenes()).toEqual(fullSequence);
    expect(harness.eventTypes().filter((type) => type === "COMPLETE")).toHaveLength(1);
    expect(harness.controller.state()).toBe("complete");

    harness.send({ type: "PLAY" });
    vi.advanceTimersByTime(60_000);
    expect(harness.eventTypes().at(-1)).toBe("COMPLETE");
    expect(harness.eventTypes()).toHaveLength(8);
  });

  it("ignores PLAY while playing", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PLAY" });
    harness.send({ type: "PLAY" });

    expect(harness.scenes()).toEqual(["opening"]);
  });

  it("lets the letter wait for the recipient", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PLAY" });
    vi.advanceTimersByTime(5000 + 3 * 6000);
    expect(stageScene()).toBe("letter");

    vi.advanceTimersByTime(60_000);

    expect(harness.scenes()).toEqual(fullSequence.slice(0, -1));
    expect(harness.eventTypes()).not.toContain("COMPLETE");
  });

  it("advances automatically after 5 s for the opening and 6 s per memory", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PLAY" });

    vi.advanceTimersByTime(4999);
    expect(harness.scenes()).toEqual(["opening"]);
    vi.advanceTimersByTime(1);
    expect(harness.scenes()).toEqual(["opening", "memory-1"]);
    vi.advanceTimersByTime(6000);
    expect(harness.scenes()).toEqual(["opening", "memory-1", "memory-2"]);
  });

  it("freezes on PAUSE and resumes the same scene with the remaining time", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PLAY" });
    harness.next();
    harness.next();
    vi.advanceTimersByTime(2000);

    harness.send({ type: "PAUSE" });
    const button = document.querySelector<HTMLButtonElement>("button.next");
    expect(button?.disabled).toBe(true);
    expect(document.body.dataset["state"]).toBe("paused");
    button?.click();
    vi.advanceTimersByTime(30_000);
    expect(harness.scenes()).toEqual(["opening", "memory-1", "memory-2"]);
    harness.send({ type: "PAUSE" });

    harness.send({ type: "PLAY" });
    expect(document.querySelector<HTMLButtonElement>("button.next")?.disabled).toBe(false);
    expect(stageScene()).toBe("memory-2");
    vi.advanceTimersByTime(3999);
    expect(harness.scenes()).toEqual(["opening", "memory-1", "memory-2"]);
    vi.advanceTimersByTime(1);
    expect(harness.scenes()).toEqual(["opening", "memory-1", "memory-2", "memory-3"]);
  });

  it("resumes the letter without a timer", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PLAY" });
    vi.advanceTimersByTime(5000 + 3 * 6000);
    harness.send({ type: "PAUSE" });
    harness.send({ type: "PLAY" });
    vi.advanceTimersByTime(60_000);

    expect(stageScene()).toBe("letter");
    harness.next();
    expect(stageScene()).toBe("finale");
  });

  it("does not complete while paused during the finale", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PLAY" });
    vi.advanceTimersByTime(5000 + 3 * 6000);
    harness.next();
    vi.advanceTimersByTime(500);

    harness.send({ type: "PAUSE" });
    vi.advanceTimersByTime(10_000);
    expect(harness.eventTypes()).not.toContain("COMPLETE");

    harness.send({ type: "PLAY" });
    vi.advanceTimersByTime(699);
    expect(harness.eventTypes()).not.toContain("COMPLETE");
    vi.advanceTimersByTime(1);
    expect(harness.eventTypes().at(-1)).toBe("COMPLETE");
  });

  it("runs only the opening and finale without memories and letter", () => {
    const harness = createHarness();
    harness.send(
      initMessage({ "opening-message": "Mở hộp nhé!", "receiver-name": "An" }, { assets: {} }),
    );
    harness.send({ type: "PLAY" });
    vi.advanceTimersByTime(5000 + 1200);

    expect(harness.scenes()).toEqual(["opening", "finale"]);
    expect(harness.eventTypes().at(-1)).toBe("COMPLETE");
  });

  it("stops everything on DESTROY", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PLAY" });

    harness.send({ type: "DESTROY" });
    vi.advanceTimersByTime(60_000);
    harness.send(initMessage());
    harness.send({ type: "PLAY" });

    expect(harness.onDestroy).toHaveBeenCalledOnce();
    expect(harness.controller.state()).toBe("destroyed");
    expect(harness.scenes()).toEqual(["opening"]);
    expect(document.getElementById("app")?.childElementCount).toBe(0);
  });
});

describe("content issues", () => {
  it("reports each missing required field once after READY and shows Gửi bạn", () => {
    const harness = createHarness();

    harness.send(initMessage({}, { assets: {} }));

    expect(harness.events).toEqual([
      { protocolVersion: 1, type: "READY" },
      ...["receiver-name", "opening-message", "memories", "final-letter"].map((fieldId) => ({
        code: "CONTENT_MISSING",
        fieldId,
        protocolVersion: 1,
        type: "ISSUE",
      })),
    ]);
    expect(document.querySelector("h1")?.textContent).toBe("Gửi bạn");
  });

  it("skips the letter when the final letter has the wrong type", () => {
    const harness = createHarness();
    harness.send(initMessage(completePayload({ "final-letter": 42 })));
    harness.send({ type: "PLAY" });
    vi.advanceTimersByTime(5000 + 3 * 6000 + 1200);

    expect(harness.events).toContainEqual({
      code: "CONTENT_MISSING",
      fieldId: "final-letter",
      protocolVersion: 1,
      type: "ISSUE",
    });
    expect(harness.scenes()).toEqual(["opening", "memory-1", "memory-2", "memory-3", "finale"]);
  });

  it("does not send an issue for the theme", () => {
    const harness = createHarness();

    harness.send(initMessage(completePayload({ theme: "ocean" }), { assets: ASSET_URLS }));

    expect(harness.eventTypes()).toEqual(["READY"]);
  });
});
