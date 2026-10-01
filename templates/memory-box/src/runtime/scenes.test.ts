import { describe, expect, it } from "vitest";

import { ASSET_URLS, completePayload } from "../test/harness";
import { normalizeInit } from "./payload";
import { buildScenes, SCENE_DELAYS_MS } from "./scenes";

function scenesFor(payload: Readonly<Record<string, unknown>>, reducedMotion = false) {
  return buildScenes(normalizeInit(payload, ASSET_URLS).content, reducedMotion);
}

describe("buildScenes", () => {
  it("orders opening, one scene per memory, letter and finale with their delays", () => {
    expect(scenesFor(completePayload())).toEqual([
      { delayMs: 5000, id: "opening", kind: "opening" },
      { delayMs: 6000, id: "memory-1", kind: "memory", memoryIndex: 0 },
      { delayMs: 6000, id: "memory-2", kind: "memory", memoryIndex: 1 },
      { delayMs: 6000, id: "memory-3", kind: "memory", memoryIndex: 2 },
      { delayMs: null, id: "letter", kind: "letter" },
      { delayMs: 1200, id: "finale", kind: "finale" },
    ]);
    expect(SCENE_DELAYS_MS).toEqual({ finale: 1200, memory: 6000, opening: 5000 });
  });

  it("skips the memory scenes and the letter when their content is missing", () => {
    expect(
      scenesFor({ "opening-message": "Xin chào", "receiver-name": "An" }).map((scene) => scene.id),
    ).toEqual(["opening", "finale"]);
  });

  it("removes only the finale delay under reduced motion", () => {
    const scenes = scenesFor(completePayload(), true);

    expect(scenes.at(-1)).toEqual({ delayMs: 0, id: "finale", kind: "finale" });
    expect(scenes[0]?.delayMs).toBe(5000);
    expect(scenes[1]?.delayMs).toBe(6000);
  });
});
