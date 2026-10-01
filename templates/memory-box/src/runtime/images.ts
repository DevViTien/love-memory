import type { MemoryItem } from "./payload";

type PhotoEntry = {
  element?: HTMLImageElement;
  readonly memory: MemoryItem;
  state: "failed" | "idle" | "loaded" | "loading";
  readonly url: string;
};

export type PhotoLoader = Readonly<{
  /** Starts preloading the photos in order, one at a time. */
  start: () => void;
  /** Stops reporting load results; the elements are dropped with the loader. */
  stop: () => void;
  /**
   * The element to display for a memory, starting its load now if the preload has not reached it.
   * Returns `undefined` when the memory has no URL or its photo failed to load.
   */
  take: (index: number) => HTMLImageElement | undefined;
}>;

export type PhotoLoaderOptions = Readonly<{
  document: Pick<Document, "createElement">;
  /** Wraps event callbacks in the runtime error boundary. */
  guard: (callback: () => void) => () => void;
  memories: readonly MemoryItem[];
  onError: (index: number) => void;
}>;

/**
 * Loads each photo URL at most once per accepted `INIT` into one `HTMLImageElement`, which the
 * memory card then displays. Signed URLs may expire before a late scene, so a scene never requests
 * the URL a second time.
 */
export function createPhotoLoader({
  document,
  guard,
  memories,
  onError,
}: PhotoLoaderOptions): PhotoLoader {
  const entries = new Map<number, PhotoEntry>();
  for (const memory of memories) {
    if (memory.url !== undefined) {
      entries.set(memory.index, { memory, state: "idle", url: memory.url });
    }
  }
  let started = false;
  let stopped = false;
  let waitingFor: PhotoEntry | undefined;

  function pump() {
    if (!started || stopped || waitingFor) return;
    const next = [...entries.values()].find((entry) => entry.state === "idle");
    if (!next) return;
    waitingFor = next;
    begin(next);
  }

  function settle(entry: PhotoEntry, loaded: boolean) {
    if (stopped) return;
    entry.state = loaded ? "loaded" : "failed";
    if (!loaded) onError(entry.memory.index);
    if (waitingFor === entry) {
      waitingFor = undefined;
      pump();
    }
  }

  function begin(entry: PhotoEntry) {
    const image = document.createElement("img");
    entry.state = "loading";
    entry.element = image;
    image.alt = entry.memory.caption ?? entry.memory.label;
    image.className = "photo";
    image.decoding = "async";
    image.draggable = false;
    image.referrerPolicy = "no-referrer";
    image.addEventListener(
      "load",
      guard(() => settle(entry, true)),
      { once: true },
    );
    image.addEventListener(
      "error",
      guard(() => settle(entry, false)),
      { once: true },
    );
    image.src = entry.url;
  }

  return {
    start() {
      started = true;
      pump();
    },
    stop() {
      stopped = true;
    },
    take(index) {
      const entry = entries.get(index);
      if (!entry || entry.state === "failed") return undefined;
      if (entry.state === "idle") begin(entry);
      return entry.element;
    },
  };
}
