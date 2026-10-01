import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ASSET_IDS,
  ASSET_URLS,
  completePayload,
  createHarness,
  initMessage,
  stageScene,
} from "../test/harness";

function spyOnSrc() {
  return vi.spyOn(HTMLImageElement.prototype, "src", "set");
}

let srcSetter: ReturnType<typeof spyOnSrc>;

beforeEach(() => {
  vi.useFakeTimers();
  srcSetter = spyOnSrc();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function requestedUrls(): string[] {
  return srcSetter.mock.calls.map(([url]) => String(url));
}

function imageFor(url: string): HTMLImageElement {
  const index = requestedUrls().indexOf(url);
  const element = srcSetter.mock.contexts[index] as HTMLImageElement | undefined;
  if (!element) throw new Error(`No image requested ${url}`);
  return element;
}

describe("memory photos", () => {
  it("shows the photo with its caption as alternative text and no referrer", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PLAY" });
    harness.next();

    const image = document.querySelector<HTMLImageElement>(".frame img");
    expect(stageScene()).toBe("memory-1");
    expect(image?.getAttribute("src")).toBe(ASSET_URLS[ASSET_IDS[0]]);
    expect(image?.alt).toBe("Đà Lạt 2023 🌲");
    expect(image?.referrerPolicy).toBe("no-referrer");
    expect(image?.className).toBe("photo");
    expect(document.querySelector("figcaption")?.textContent).toBe("Đà Lạt 2023 🌲");
  });

  it("uses Kỷ niệm {n} as alternative text without a caption", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PLAY" });
    harness.next();
    harness.next();
    harness.next();

    expect(document.querySelector<HTMLImageElement>(".frame img")?.alt).toBe("Kỷ niệm 3");
    expect(document.querySelector("figcaption")).toBeNull();
  });

  it("preloads photos in order, one at a time, after READY", () => {
    const harness = createHarness();
    harness.send(initMessage());

    expect(harness.eventTypes()).toEqual(["READY"]);
    expect(requestedUrls()).toEqual([ASSET_URLS[ASSET_IDS[0]]]);
    imageFor(ASSET_URLS[ASSET_IDS[0]] ?? "").dispatchEvent(new Event("load"));
    expect(requestedUrls()).toEqual([ASSET_URLS[ASSET_IDS[0]], ASSET_URLS[ASSET_IDS[1]]]);
    imageFor(ASSET_URLS[ASSET_IDS[1]] ?? "").dispatchEvent(new Event("error"));
    expect(requestedUrls()).toHaveLength(3);
    imageFor(ASSET_URLS[ASSET_IDS[2]] ?? "").dispatchEvent(new Event("load"));
    expect(requestedUrls()).toHaveLength(3);
  });

  it("shows a text card for an asset without a URL and never requests it", () => {
    const harness = createHarness();
    const missing = "550e8400-e29b-41d4-a716-000000000009";
    harness.send(
      initMessage(
        completePayload({
          memories: [
            { assetId: ASSET_IDS[0], caption: "Một" },
            { assetId: missing, caption: "Ảnh bị thiếu" },
            { assetId: ASSET_IDS[2], caption: "Ba" },
          ],
        }),
      ),
    );

    expect(harness.events).toEqual([
      { protocolVersion: 1, type: "READY" },
      {
        code: "ASSET_UNAVAILABLE",
        fieldId: "memories",
        itemIndex: 1,
        protocolVersion: 1,
        type: "ISSUE",
      },
    ]);
    harness.send({ type: "PLAY" });
    harness.next();
    harness.next();

    expect(stageScene()).toBe("memory-2");
    expect(document.querySelector(".frame img")).toBeNull();
    expect(document.querySelector(".text-card")?.textContent).toBe("Ảnh bị thiếu");
    expect(requestedUrls()).not.toContain(undefined);
    expect(requestedUrls().every((url) => Object.values(ASSET_URLS).includes(url))).toBe(true);
  });

  it("replaces a photo that fails to load with a text card and reports it once", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PLAY" });
    harness.next();
    harness.next();
    harness.next();
    expect(stageScene()).toBe("memory-3");
    const third = imageFor(ASSET_URLS[ASSET_IDS[2]] ?? "");
    expect(document.querySelector(".frame img")).toBe(third);

    third.dispatchEvent(new Event("error"));

    expect(harness.events).toContainEqual({
      code: "ASSET_UNAVAILABLE",
      fieldId: "memories",
      itemIndex: 2,
      protocolVersion: 1,
      type: "ISSUE",
    });
    expect(document.querySelector(".frame img")).toBeNull();
    expect(document.querySelector(".text-card")?.textContent).toBe("Kỷ niệm 3");
    expect(harness.scenes().at(-1)).toBe("memory-3");
  });

  it("shows a text card when a photo failed before its scene", () => {
    const harness = createHarness();
    harness.send(initMessage());
    imageFor(ASSET_URLS[ASSET_IDS[0]] ?? "").dispatchEvent(new Event("error"));
    harness.send({ type: "PLAY" });
    harness.next();

    expect(document.querySelector(".frame img")).toBeNull();
    expect(document.querySelector(".text-card")?.textContent).toBe("Đà Lạt 2023 🌲");
    expect(harness.eventTypes().filter((type) => type === "ISSUE")).toHaveLength(1);
  });

  it("shows the preloaded element in a late scene without requesting the URL again", () => {
    const harness = createHarness();
    harness.send(initMessage());
    const preloaded = imageFor(ASSET_URLS[ASSET_IDS[0]] ?? "");
    preloaded.dispatchEvent(new Event("load"));
    // The signed URL "expires" now: any second request would fail.
    vi.advanceTimersByTime(10 * 60_000);
    harness.send({ type: "PLAY" });
    harness.next();

    expect(document.querySelector(".frame img")).toBe(preloaded);
    expect(requestedUrls().filter((url) => url === ASSET_URLS[ASSET_IDS[0]])).toHaveLength(1);
    expect(harness.eventTypes()).not.toContain("ISSUE");
  });

  it("starts loading a photo when its scene comes before the preload", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PLAY" });
    harness.next();
    harness.next();

    expect(stageScene()).toBe("memory-2");
    expect(requestedUrls()).toEqual([ASSET_URLS[ASSET_IDS[0]], ASSET_URLS[ASSET_IDS[1]]]);
    expect(document.querySelector(".frame img")).toBe(imageFor(ASSET_URLS[ASSET_IDS[1]] ?? ""));
    imageFor(ASSET_URLS[ASSET_IDS[0]] ?? "").dispatchEvent(new Event("load"));
    expect(requestedUrls()).toEqual([
      ASSET_URLS[ASSET_IDS[0]],
      ASSET_URLS[ASSET_IDS[1]],
      ASSET_URLS[ASSET_IDS[2]],
    ]);
  });

  it("ignores load results of a replaced INIT", () => {
    const harness = createHarness();
    harness.send(initMessage());
    const stale = imageFor(ASSET_URLS[ASSET_IDS[0]] ?? "");
    harness.send(initMessage(completePayload({ theme: "warm-paper" })));

    stale.dispatchEvent(new Event("error"));

    expect(harness.eventTypes()).toEqual(["READY", "READY"]);
  });
});
