import type { TemplateEvent } from "@love-memory/template-sdk";
import { vi } from "vitest";

import { createMemoryBoxController, type MemoryBoxController } from "../runtime/controller";
import { createPhotoLoader } from "../runtime/images";
import { createDomView, type MemoryBoxView } from "../runtime/render";

export const ASSET_IDS = [
  "550e8400-e29b-41d4-a716-446655441001",
  "550e8400-e29b-41d4-a716-446655441002",
  "550e8400-e29b-41d4-a716-446655441003",
  "550e8400-e29b-41d4-a716-446655441004",
] as const;

export const ASSET_URLS: Readonly<Record<string, string>> = Object.fromEntries(
  ASSET_IDS.map((id, index) => [id, `https://assets.example.test/photo-${index + 1}.webp`]),
);

/** A complete payload with three captioned memories and a two-paragraph letter. */
export function completePayload(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    "anniversary-date": "2024-09-15",
    "final-letter": "Đoạn một của lá thư.\n\nĐoạn hai của lá thư.",
    memories: [
      { assetId: ASSET_IDS[0], caption: "Đà Lạt 2023 🌲" },
      { assetId: ASSET_IDS[1], caption: "Bữa tối đầu tiên" },
      { assetId: ASSET_IDS[2] },
    ],
    "opening-message": "Mở hộp nhé!",
    "receiver-name": "An",
    theme: "rose-night",
    ...overrides,
  };
}

export function initMessage(
  payload: Readonly<Record<string, unknown>> = completePayload(),
  { assets = ASSET_URLS, reducedMotion = false } = {},
) {
  return {
    assets,
    context: { locale: "vi-VN", prefersReducedMotion: reducedMotion },
    payload,
    protocolVersion: 1,
    type: "INIT",
  };
}

export type Harness = Readonly<{
  controller: MemoryBoxController;
  events: TemplateEvent[];
  eventTypes: () => string[];
  next: () => void;
  onDestroy: ReturnType<typeof vi.fn>;
  scenes: () => string[];
  send: (data: unknown) => void;
}>;

/**
 * A controller wired to the jsdom document and the global (fake) timers. `wrapView` lets a test
 * replace parts of the real DOM view, for example to make rendering throw.
 */
export function createHarness(
  wrapView: (view: MemoryBoxView) => MemoryBoxView = (view) => view,
): Harness {
  document.body.replaceChildren();
  document.body.removeAttribute("style");
  for (const name of ["data-motion", "data-paused", "data-state", "data-theme"])
    document.body.removeAttribute(name);
  const events: TemplateEvent[] = [];
  const onDestroy = vi.fn();
  const controller = createMemoryBoxController({
    clearTimer: (id) => clearTimeout(id),
    createPhotoLoader: (options) => createPhotoLoader({ ...options, document }),
    createView: (onNext) => wrapView(createDomView(document, onNext)),
    now: () => Date.now(),
    onDestroy,
    post: (event) => events.push(event),
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs) as unknown as number,
  });

  return {
    controller,
    events,
    eventTypes: () => events.map((event) => event.type),
    next: () => {
      const button = document.querySelector<HTMLButtonElement>("button.next");
      if (!button) throw new Error("No Tiếp button is shown.");
      button.click();
    },
    onDestroy,
    scenes: () => events.flatMap((event) => (event.type === "SCENE" ? [event.sceneId] : [])),
    send: (data) => controller.receive(data),
  };
}

export function stageScene(): string | null {
  return document.querySelector("#stage section")?.getAttribute("data-scene") ?? null;
}
