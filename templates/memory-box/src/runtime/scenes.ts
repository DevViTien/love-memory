import type { MemoryBoxContent } from "./payload";

export const SCENE_DELAYS_MS = Object.freeze({
  finale: 1200,
  memory: 6000,
  opening: 5000,
});

export type SceneKind = "finale" | "letter" | "memory" | "opening";

export type Scene = Readonly<{
  /** Milliseconds until the scene advances (or completes, for `finale`); `null` waits for `Tiếp`. */
  delayMs: number | null;
  id: string;
  kind: SceneKind;
  /** Position in `content.memories` for memory scenes. */
  memoryIndex?: number;
}>;

/**
 * The ordered scenes after the cover: `opening`, `memory-1..n`, `letter` and `finale`. Memory
 * scenes and the letter are skipped when their content is absent; `opening` and `finale` always
 * run. Reduced motion removes only the finale settle delay.
 */
export function buildScenes(content: MemoryBoxContent, reducedMotion: boolean): Scene[] {
  return [
    { delayMs: SCENE_DELAYS_MS.opening, id: "opening", kind: "opening" },
    ...content.memories.map((_memory, memoryIndex): Scene => ({
      delayMs: SCENE_DELAYS_MS.memory,
      id: `memory-${memoryIndex + 1}`,
      kind: "memory",
      memoryIndex,
    })),
    ...(content.finalLetter === undefined
      ? []
      : [{ delayMs: null, id: "letter", kind: "letter" } satisfies Scene]),
    { delayMs: reducedMotion ? 0 : SCENE_DELAYS_MS.finale, id: "finale", kind: "finale" },
  ];
}
