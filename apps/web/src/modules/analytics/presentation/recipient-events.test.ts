import { describe, expect, it, vi } from "vitest";

import { type AnalyticsClient } from "./analytics-client";
import { createRecipientEventReporter } from "./recipient-events";

function setup() {
  const sent: string[] = [];
  const client: AnalyticsClient = {
    send: vi.fn(
      (name: string, sceneId?: string) => void sent.push(sceneId ? `${name}:${sceneId}` : name),
    ),
    sendOnce: vi.fn(),
  };
  return { report: createRecipientEventReporter(client), sent };
}

const scene = (sceneId: string) => ({ sceneId, type: "scene" as const });

describe("recipient event reporter", () => {
  it("reports a full play-through in order, each once (Full play-through)", () => {
    const { report, sent } = setup();
    report({ type: "opened" });
    for (const id of ["opening", "memory-1", "memory-2", "memory-3", "letter", "finale"]) {
      report(scene(id));
    }
    report({ type: "completed" });

    expect(sent).toEqual([
      "gift_open_interaction",
      "scene_completed:opening",
      "scene_completed:memory-1",
      "scene_completed:memory-2",
      "scene_completed:memory-3",
      "scene_completed:letter",
      "scene_completed:finale",
      "gift_completed",
    ]);
  });

  it("does not complete a scene when its own notice repeats", () => {
    const { report, sent } = setup();
    report({ type: "opened" });
    report(scene("memory-1"));
    report(scene("memory-1"));
    expect(sent).toEqual(["gift_open_interaction"]);

    report(scene("memory-2"));
    expect(sent).toEqual(["gift_open_interaction", "scene_completed:memory-1"]);
  });

  it("stops after a fallback during memory-2 (Template fails after opening)", () => {
    const { report, sent } = setup();
    report({ type: "opened" });
    report(scene("opening"));
    report(scene("memory-1"));
    report(scene("memory-2"));
    report({ reason: "ERROR", type: "fallback" });
    report(scene("memory-3"));
    report({ type: "completed" });

    expect(sent).toEqual([
      "gift_open_interaction",
      "scene_completed:opening",
      "scene_completed:memory-1",
    ]);
  });

  it("ignores scene notifications after completed and a second completed", () => {
    const { report, sent } = setup();
    report({ type: "opened" });
    report(scene("finale"));
    report({ type: "completed" });
    report(scene("opening"));
    report(scene("memory-1"));
    report({ type: "completed" });

    expect(sent).toEqual(["gift_open_interaction", "scene_completed:finale", "gift_completed"]);
  });

  it("sends a repeated scene id once and opened once", () => {
    const { report, sent } = setup();
    report({ type: "opened" });
    report({ type: "opened" });
    report(scene("opening"));
    report(scene("memory-1"));
    report(scene("opening"));
    report(scene("memory-1"));
    report(scene("letter"));

    expect(sent).toEqual([
      "gift_open_interaction",
      "scene_completed:opening",
      "scene_completed:memory-1",
    ]);
  });

  it("skips a scene id that is not a kebab-case slug", () => {
    const { report, sent } = setup();
    report({ type: "opened" });
    report(scene("Memory 1"));
    report(scene("opening"));
    report(scene(`x${"-y".repeat(50)}`));
    report({ type: "completed" });

    expect(sent).toEqual(["gift_open_interaction", "scene_completed:opening", "gift_completed"]);
  });

  it("sends gift_completed alone when no scene was reported", () => {
    const { report, sent } = setup();
    report({ type: "opened" });
    report({ type: "completed" });
    expect(sent).toEqual(["gift_open_interaction", "gift_completed"]);
  });

  it("ignores scene and completed notifications before opened", () => {
    const { report, sent } = setup();
    report(scene("opening"));
    report({ type: "completed" });
    report({ type: "opened" });
    report(scene("memory-1"));
    report(scene("letter"));
    report({ type: "completed" });

    expect(sent).toEqual([
      "gift_open_interaction",
      "scene_completed:memory-1",
      "scene_completed:letter",
      "gift_completed",
    ]);
  });

  it("sends nothing for a fallback, before or after opening", () => {
    const { report, sent } = setup();
    report({ reason: "LOAD_TIMEOUT", type: "fallback" });
    report({ type: "opened" });
    report(scene("opening"));
    report({ type: "completed" });

    expect(sent).toEqual(["gift_open_interaction"]);
  });
});
