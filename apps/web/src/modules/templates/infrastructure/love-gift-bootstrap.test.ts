import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type HtmlTemplateSource, prepareHtmlTemplate } from "../application/html-template-import";
import { PNG_BYTES } from "../application/test/html-template-fixtures";
import { readLoveGiftBootstrap } from "./html-template-folder";

/**
 * Runs a prepared `html` artifact in a jsdom iframe of the test window: the bootstrap inline (jsdom
 * loads no external script), and each deferred template script evaluated in the frame when the
 * bootstrap inserts it, like a browser loading `script-{n}.js` in order.
 */

const manifest = {
  budgets: { initialJsKbGzip: 20, initialMediaKb: 50, maxTextureMb: 8 },
  capabilities: ["dom"],
  fields: [
    { id: "name", label: "Tên", maxLength: 30, path: "person.name", type: "shortText" },
    { id: "letter", label: "Thư", maxLength: 300, path: "letter", type: "longText" },
    { id: "day", label: "Ngày", path: "day", type: "date" },
    {
      id: "lines",
      itemMaxLength: 40,
      label: "Lời nhắn",
      maxItems: 5,
      minItems: 0,
      path: "lines",
      type: "textList",
    },
    { id: "avatar", label: "Ảnh", path: "person.avatar", type: "image" },
    { id: "cover", label: "Bìa", path: "cover", type: "image" },
    {
      aspectRatio: "1:1",
      id: "photos",
      label: "Ảnh",
      maxItems: 3,
      minItems: 0,
      path: "photos",
      type: "imageList",
    },
    {
      aspectRatio: "1:1",
      captionMaxLength: 40,
      id: "memories",
      label: "Kỷ niệm",
      maxItems: 3,
      minItems: 0,
      path: "memories",
      type: "captionedImageList",
    },
    {
      id: "theme",
      label: "Giao diện",
      options: ["rose", "night"],
      path: "style.theme",
      type: "theme",
    },
    { id: "pin", label: "Mã", length: 4, path: "pin", type: "passcode" },
    { id: "accent", label: "Màu", path: "style.accent", type: "color" },
    { id: "audio", label: "Nhạc", source: "licensedLibrary", type: "audio" },
  ],
  id: "bootstrap-test",
  kind: "html",
  meta: {
    description: "Thử bootstrap.",
    estimatedDurationSec: 10,
    moods: ["warm"],
    name: "Thử",
    occasions: ["anniversary"],
  },
  status: "published",
  version: "1.0.0",
};

const defaults = {
  cover: "assets/cover.png",
  day: "2020-01-01",
  letter: "Mặc định",
  lines: ["Một"],
  memories: [{ caption: "Mẫu", src: "assets/cover.png" }],
  person: { avatar: "", name: "Minh" },
  photos: ["assets/cover.png"],
  pin: "0000",
  style: { accent: "#000000", theme: "rose" },
  title: "LOVE",
};

const A = "550e8400-e29b-41d4-a716-446655440001";
const B = "550e8400-e29b-41d4-a716-446655440002";
const C = "550e8400-e29b-41d4-a716-446655440003";

type Frame = Readonly<{
  posted: unknown[];
  send: (data: unknown, source?: unknown) => void;
  window: Window & typeof globalThis & Record<string, unknown>;
}>;

function document(scripts: readonly string[]): string {
  return `<!doctype html><html><head><title>t</title></head><body>
<script type="application/json" id="gift-config">${JSON.stringify(defaults)}</script>
${scripts.map((script) => `<script>${script}</script>`).join("\n")}
</body></html>`;
}

const frames: HTMLIFrameElement[] = [];

/** Loads the artifact of `scripts` into a new iframe and returns its window and posted events. */
async function load(
  scripts: readonly string[],
  options: Readonly<{ topLevel?: boolean }> = {},
): Promise<Frame> {
  const source: HtmlTemplateSource = {
    assets: [{ bytes: PNG_BYTES, name: "assets/cover.png" }],
    bootstrap: readLoveGiftBootstrap(),
    indexHtml: document(scripts),
    manifest,
  };
  const prepared = prepareHtmlTemplate(source);
  const text = (name: string) =>
    new TextDecoder().decode(prepared.files.find((file) => file.name === name)?.body);
  const bootstrap = `<script>${text("love-gift.js")}</script>`;
  // jsdom reports `complete` while `document.write` parses, so a top-level run (which starts on a
  // complete document at once) gets the bootstrap after the parsed body, as a browser would see it.
  const html = options.topLevel
    ? text("index.html")
        .replace('<script src="love-gift.js"></script>', "")
        .replace("</body>", `${bootstrap}</body>`)
    : text("index.html").replace('<script src="love-gift.js"></script>', bootstrap);

  const iframe = window.document.createElement("iframe");
  window.document.body.append(iframe);
  frames.push(iframe);
  const frameWindow = iframe.contentWindow as Frame["window"];
  if (options.topLevel) Object.defineProperty(frameWindow, "parent", { value: frameWindow });

  const posted: unknown[] = [];
  // jsdom gives the frame a parent proxy that is not the test `window` object itself.
  const parent = options.topLevel ? frameWindow : frameWindow.parent;
  vi.spyOn(parent, "postMessage").mockImplementation((message: unknown) => {
    posted.push(message);
  });

  // A browser loads each inserted `script-{n}.js`, runs it, then fires `load` (or `error`).
  new frameWindow.MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        const script = node as HTMLScriptElement;
        const name = script.getAttribute?.("src");
        if (script.nodeName !== "SCRIPT" || !name) continue;
        setTimeout(() => {
          const body = prepared.files.find((file) => file.name === name);
          if (!body) {
            script.dispatchEvent(new frameWindow.Event("error"));
            return;
          }
          try {
            (frameWindow as unknown as { eval: (code: string) => unknown }).eval(text(name));
          } catch (error) {
            frameWindow.dispatchEvent(new frameWindow.ErrorEvent("error", { error }));
          }
          script.dispatchEvent(new frameWindow.Event("load"));
        }, 0);
      }
    }
  }).observe(frameWindow.document, { childList: true, subtree: true });

  frameWindow.document.open();
  frameWindow.document.write(html);
  frameWindow.document.close();
  await vi.waitFor(() => expect(frameWindow.document.readyState).toBe("complete"));

  return {
    posted,
    send(data, from = parent) {
      const event = new frameWindow.MessageEvent("message", { data });
      Object.defineProperty(event, "source", { value: from });
      frameWindow.dispatchEvent(event);
    },
    window: frameWindow,
  };
}

function init(payload: Record<string, unknown>, assets: Record<string, string> = {}) {
  return {
    assets,
    context: { locale: "vi-VN", prefersReducedMotion: false },
    payload,
    protocolVersion: 1,
    type: "INIT",
  };
}

const READY = { protocolVersion: 1, type: "READY" };

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  for (const iframe of frames.splice(0)) iframe.remove();
});

const PLAY = { type: "PLAY" };
const RUNTIME_ERROR = { code: "RUNTIME_ERROR", type: "ERROR" };

/** `INIT`, then `READY`, then the recipient's `Mở quà` (`PLAY`). */
async function play(frame: Frame, message: unknown = init({})): Promise<void> {
  frame.send(message);
  await vi.waitFor(() => expect(frame.posted).toContainEqual(READY));
  frame.send(PLAY);
}

describe("LoveGift bootstrap", () => {
  it("merges the gift's values into the defaults by path and answers READY", async () => {
    const frame = await load([
      "window.order = ['first']; window.seen = LoveGift.config();",
      "window.order.push('second');",
    ]);
    expect(frame.window["seen"]).toBeUndefined();

    frame.send(
      init(
        {
          accent: "#ff3366",
          audio: "acoustic-morning",
          avatar: A,
          cover: C,
          day: "2023-08-14",
          letter: "  Thư của anh  ",
          lines: ["  Một ", "   ", "Hai"],
          memories: [{ assetId: A, caption: " Đà Lạt " }, { assetId: C }, { assetId: B }],
          name: "Hana",
          photos: [A, C, B],
          pin: "0420",
          theme: "night",
        },
        { [A]: "https://blob.test/a.jpg", [B]: "https://blob.test/b.jpg" },
      ),
    );
    await vi.waitFor(() => expect(frame.posted).toEqual([READY]));
    // Nothing of the template runs before the recipient opens the gift.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(frame.window["order"]).toBeUndefined();

    frame.send(PLAY);
    await vi.waitFor(() => expect(frame.window["order"]).toEqual(["first", "second"]));
    expect(frame.posted).toEqual([READY]);
    expect(JSON.parse(JSON.stringify(frame.window["seen"]))).toEqual({
      cover: "assets/cover.png",
      day: "2023-08-14",
      letter: "Thư của anh",
      lines: ["Một", "Hai"],
      memories: [
        { caption: "Đà Lạt", src: "https://blob.test/a.jpg" },
        { caption: "", src: "https://blob.test/b.jpg" },
      ],
      person: { avatar: "https://blob.test/a.jpg", name: "Hana" },
      photos: ["https://blob.test/a.jpg", "https://blob.test/b.jpg"],
      pin: "0420",
      style: { accent: "#ff3366", theme: "night" },
      title: "LOVE",
    });
  });

  it("starts loading every photo at INIT, while the signed URLs are still valid", async () => {
    const frame = await load([]);
    const requested: string[] = [];
    const prototype = frame.window.HTMLImageElement.prototype;
    const original = Object.getOwnPropertyDescriptor(prototype, "src");
    Object.defineProperty(prototype, "src", {
      configurable: true,
      get: () => "",
      set: (value: string) => requested.push(value),
    });
    try {
      frame.send(
        init(
          { avatar: A, memories: [{ assetId: B }], photos: [A, B] },
          { [A]: "https://blob.test/a.jpg", [B]: "https://blob.test/b.jpg" },
        ),
      );
      await vi.waitFor(() => expect(frame.posted).toEqual([READY]));

      // In field order: avatar, cover (its default), photos, memories; before any `PLAY`.
      expect(requested).toEqual([
        "https://blob.test/a.jpg",
        "assets/cover.png",
        "https://blob.test/a.jpg",
        "https://blob.test/b.jpg",
        "https://blob.test/b.jpg",
      ]);
    } finally {
      if (original) Object.defineProperty(prototype, "src", original);
    }
  });

  it("dispatches the last PAUSE or PLAY received while the scripts load, once started", async () => {
    const frame = await load([
      "window.events = []; addEventListener('lovegift:pause', () => events.push('pause')); addEventListener('lovegift:play', () => events.push('play'));",
    ]);

    frame.send(init({}));
    await vi.waitFor(() => expect(frame.posted).toEqual([READY]));
    frame.send(PLAY);
    frame.send({ type: "PLAY" });
    frame.send({ type: "PAUSE" });

    await vi.waitFor(() => expect(frame.window["events"]).toEqual(["pause"]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(frame.window["events"]).toEqual(["pause"]);
  });

  it("keeps a default when a value is absent, empty or has no available asset", async () => {
    const frame = await load(["window.seen = LoveGift.config();"]);

    await play(frame, init({ lines: [" "], memories: [{ assetId: C }], name: "   ", photos: [C] }));
    await vi.waitFor(() => expect(frame.window["seen"]).toBeDefined());

    expect(JSON.parse(JSON.stringify(frame.window["seen"]))).toEqual(defaults);
  });

  it("answers repeated INIT with READY and runs the scripts once, on the first PLAY", async () => {
    const frame = await load([
      "window.runs = (window.runs || 0) + 1;",
      "window.events = []; addEventListener('lovegift:pause', () => events.push('pause')); addEventListener('lovegift:play', () => events.push('play'));",
    ]);

    await play(frame);
    frame.send(init({ name: "Khác" }));
    await vi.waitFor(() => expect(frame.window["events"]).toEqual([]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    frame.send({ type: "PAUSE" });
    frame.send(PLAY);

    expect(frame.posted).toEqual([READY, READY]);
    expect(frame.window["runs"]).toBe(1);
    expect(frame.window["events"]).toEqual(["pause", "play"]);
  });

  it("holds a PLAY that arrives before INIT until the gift is configured", async () => {
    const frame = await load(["window.started = true;"]);

    frame.send(PLAY);
    frame.send({ type: "PAUSE" });
    frame.send({ type: "DESTROY" });
    expect(frame.window["started"]).toBeUndefined();
    frame.send(init({}));

    await vi.waitFor(() => expect(frame.window["started"]).toBe(true));
    expect(frame.posted).toEqual([READY]);
  });

  it("answers a malformed INIT with INVALID_MESSAGE and ignores other windows", async () => {
    const frame = await load(["window.started = true;"]);

    frame.send(init({}), frame.window);
    frame.send(PLAY, frame.window);
    frame.send("INIT");
    expect(frame.posted).toEqual([]);

    for (const message of [
      { ...init({}), protocolVersion: 2 },
      { ...init({}), payload: [] },
      { ...init({}), context: { locale: "vi" } },
      { ...init({}), context: null },
      { ...init({}), assets: { [A]: 1 } },
      { ...init({}), assets: "x" },
    ]) {
      frame.send(message);
    }
    expect(frame.posted).toEqual(Array(6).fill({ code: "INVALID_MESSAGE", type: "ERROR" }));
    expect(frame.window["started"]).toBeUndefined();
  });

  it("passes the host's reduced motion to the template", async () => {
    const frame = await load(["window.reduced = LoveGift.reducedMotion();"]);
    const loveGift = frame.window["LoveGift"] as { reducedMotion: () => boolean };
    expect(loveGift.reducedMotion()).toBe(false);

    await play(frame, {
      ...init({}),
      context: { locale: "vi-VN", prefersReducedMotion: true },
    });

    await vi.waitFor(() => expect(frame.window["reduced"]).toBe(true));
    expect(frame.window.document.documentElement.getAttribute("data-reduced-motion")).toBe("true");
  });

  it("reports a script that throws while starting as RUNTIME_ERROR", async () => {
    const frame = await load(["throw new Error('broken template');", "window.after = true;"]);

    await play(frame);
    await vi.waitFor(() => expect(frame.posted).toEqual([READY, RUNTIME_ERROR]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(frame.posted).toHaveLength(2);
    frame.send(init({}));
    expect(frame.posted).toHaveLength(2);
  });

  it("reports an unhandled promise rejection while starting as RUNTIME_ERROR", async () => {
    // jsdom does not raise `unhandledrejection` itself; a browser does for `Promise.reject()`.
    const frame = await load(["window.dispatchEvent(new Event('unhandledrejection'));"]);

    await play(frame);
    await vi.waitFor(() => expect(frame.posted).toEqual([READY, RUNTIME_ERROR]));
  });

  it("loads the template's scripts as CORS scripts, so the browser reports their failures", async () => {
    const frame = await load(["window.ran = true;"]);

    await play(frame);
    await vi.waitFor(() => expect(frame.window["ran"]).toBe(true));
    const scripts = Array.from(frame.window.document.querySelectorAll("script[src]")).filter(
      (script) => script.getAttribute("src")?.startsWith("script-"),
    );
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.every((script) => script.getAttribute("crossorigin") === "anonymous")).toBe(
      true,
    );
  });

  it("forwards only the RUNTIME_ERROR code, never an error's message", async () => {
    const frame = await load(["throw new Error('secret gift text');"]);

    await play(frame);
    await vi.waitFor(() => expect(frame.posted).toEqual([READY, RUNTIME_ERROR]));
    expect(JSON.stringify(frame.posted)).not.toContain("secret gift text");
  });

  it("reports a rejection that a late onload handler leaves for the next task", async () => {
    // A browser fires `unhandledrejection` in its own task, after the task of the `onload` that the
    // bootstrap calls late; jsdom fires none, so the event is dispatched from such a later task.
    const frame = await load([
      "window.onload = () => { setTimeout(() => window.dispatchEvent(new Event('unhandledrejection')), 0); };",
    ]);

    await play(frame);
    await vi.waitFor(() => expect(frame.posted).toEqual([READY, RUNTIME_ERROR]));
  });

  it("ignores an unhandled rejection after the template started", async () => {
    const frame = await load(["window.started = true;"]);

    await play(frame);
    await vi.waitFor(() => expect(frame.window["started"]).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    frame.window.dispatchEvent(new frame.window.Event("unhandledrejection"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(frame.posted).toEqual([READY]);
  });

  it("reports a deferred load listener that throws while starting", async () => {
    const frame = await load([
      "document.addEventListener('DOMContentLoaded', () => { throw new Error('late'); });",
    ]);

    await play(frame);
    await vi.waitFor(() => expect(frame.posted).toContainEqual(RUNTIME_ERROR));
  });

  it("calls DOMContentLoaded, load and onload handlers added after the document loaded", async () => {
    const frame = await load([
      "window.calls = [];",
      "document.addEventListener('DOMContentLoaded', () => window.calls.push('ready'));",
      "addEventListener('load', { handleEvent: () => window.calls.push('load') });",
      "window.onload = () => window.calls.push('onload');",
      "addEventListener('resize', () => window.calls.push('resize'));",
    ]);

    await play(frame);
    await vi.waitFor(() => expect(frame.window["calls"]).toEqual(["ready", "load", "onload"]));

    frame.window.dispatchEvent(new frame.window.Event("resize"));
    expect(frame.window["calls"]).toEqual(["ready", "load", "onload", "resize"]);
    expect(frame.posted).toEqual([READY]);
  });

  it("posts COMPLETE and valid SCENE events for the template", async () => {
    const frame = await load([
      "LoveGift.scene('heart-full'); LoveGift.scene(''); LoveGift.scene(7); LoveGift.scene('x'.repeat(81)); LoveGift.complete();",
    ]);

    await play(frame);
    await vi.waitFor(() =>
      expect(frame.posted).toEqual([
        READY,
        { sceneId: "heart-full", type: "SCENE" },
        { type: "COMPLETE" },
      ]),
    );
  });

  it("exposes a frozen LoveGift whose config is available only once the gift is configured", async () => {
    const frame = await load([]);
    const loveGift = frame.window["LoveGift"] as { config: () => unknown };

    expect(() => loveGift.config()).toThrow("LoveGift.config() is available once the gift starts.");
    expect(Object.isFrozen(loveGift)).toBe(true);
    expect(() => {
      frame.window["LoveGift"] = null;
    }).toThrow(TypeError);
    expect(frame.window["LoveGift"]).toBe(loveGift);
  });

  it("fails when a deferred script cannot be loaded", async () => {
    const frame = await load(["window.ok = true;"]);
    const placeholder = frame.window.document.querySelector(
      'script[type="application/x-love-gift-script"]',
    );
    placeholder?.setAttribute("data-src", "missing.js");

    await play(frame);
    await vi.waitFor(() => expect(frame.posted).toEqual([READY, RUNTIME_ERROR]));
  });

  it("starts with the defaults outside the host, posting nothing", async () => {
    const frame = await load(["window.seen = LoveGift.config(); LoveGift.complete();"], {
      topLevel: true,
    });

    await vi.waitFor(() => expect(frame.window["seen"]).toBeDefined());
    expect(JSON.parse(JSON.stringify(frame.window["seen"]))).toEqual(defaults);
    expect(frame.posted).toEqual([]);
  });

  it("never starts by itself in a frame", async () => {
    const frame = await load(["window.seen = LoveGift.config();"]);

    await new Promise((resolve) => setTimeout(resolve, 1700));
    expect(frame.window["seen"]).toBeUndefined();
    expect(frame.posted).toEqual([]);
  });
});
