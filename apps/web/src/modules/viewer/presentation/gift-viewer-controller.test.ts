import { type AudioPlaybackResult, type TemplateEvent } from "@love-memory/template-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ViewerLifecycleEvent,
  type ViewerPayload,
  type ViewerSource,
} from "../application/viewer-payload";
import { assetIds, viewerPayload } from "../test/viewer-fixtures";
import {
  ARTIFACT_LOAD_TIMEOUT_MS,
  ASSET_REFRESH_TIMEOUT_MS,
  createElementAudio,
  createGiftViewerController,
  createGiftViewerHost,
  createWindowTemplateBridge,
  type GiftViewerControllerOptions,
  initialGiftViewerState,
  type TemplateWindow,
} from "./gift-viewer-controller";

type Sent = string;

function createHarness(
  overrides: Partial<GiftViewerControllerOptions> &
    Readonly<{ playResult?: AudioPlaybackResult }> = {},
) {
  const sent: Sent[] = [];
  const inits: Array<Readonly<{ prefersReducedMotion: boolean; assets: Record<string, string> }>> =
    [];
  let deliver: ((event: TemplateEvent) => void) | null = null;
  const bridges: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];
  const events: ViewerLifecycleEvent[] = [];
  const audioCalls: string[] = [];
  const { playResult = "playing", ...controllerOverrides } = overrides;
  const audio = {
    pause: vi.fn(() => audioCalls.push("pause")),
    play: vi.fn(() => {
      audioCalls.push("play");
      return Promise.resolve(playResult);
    }),
    release: vi.fn(() => audioCalls.push("release")),
    setMuted: vi.fn((muted: boolean) => audioCalls.push(`muted:${muted}`)),
    setSource: vi.fn((url: string) => audioCalls.push(`src:${url}`)),
    unlock: vi.fn(() => audioCalls.push("unlock")),
  };
  const onIssuesChange = vi.fn();
  const onAssetsExpired = vi.fn();
  const onMutedChange = vi.fn();
  const controller = createGiftViewerController({
    audio,
    createBridge: (_target, onEvent) => {
      deliver = onEvent;
      const bridge = {
        destroy: vi.fn(() => {
          sent.push("DESTROY");
          deliver = null;
        }),
        disconnect: vi.fn(() => {
          deliver = null;
        }),
        initialize: vi.fn(
          (_payload: unknown, prefersReducedMotion: boolean, assets: Record<string, string>) => {
            sent.push("INIT");
            inits.push({ assets, prefersReducedMotion });
          },
        ),
        pause: vi.fn(() => sent.push("PAUSE")),
        play: vi.fn(() => sent.push("PLAY")),
        start: vi.fn(),
      };
      bridges.push(bridge);
      return bridge;
    },
    forceReducedMotion: false,
    muted: false,
    onAssetsExpired,
    onIssuesChange,
    onLifecycleEvent: (event) => events.push(event),
    onMutedChange,
    source: { kind: "ready", viewer: viewerPayload() },
    systemPrefersReducedMotion: () => false,
    ...controllerOverrides,
  });
  const frame = {} as TemplateWindow;
  return {
    audio,
    audioCalls,
    bridges,
    controller,
    emit(event: TemplateEvent) {
      deliver?.(event);
    },
    events,
    frame,
    inits,
    onAssetsExpired,
    onIssuesChange,
    onMutedChange,
    sent,
    state: () => controller.getState(),
    /** The iframe's `load` while its `src` attribute is `src` (by default the artifact URL). */
    attach(src: string | null = controller.getState().frameSrc) {
      controller.attach(frame, src);
    },
    /** Mount the iframe, set its URL, and fire its `load`. */
    load() {
      controller.mounted();
      controller.attach(frame, controller.getState().frameSrc);
    },
    ready() {
      deliver?.({ protocolVersion: 1, type: "READY" });
    },
  };
}

const flush = () => Promise.resolve().then(() => Promise.resolve());

describe("gift viewer controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("content source", () => {
    it("loads a ready source behind the envelope", () => {
      const harness = createHarness();

      expect(harness.state().frameVisible).toBe(true);
      expect(harness.state().frameSrc).toBeNull();
      harness.load();
      harness.ready();

      expect(harness.state()).toMatchObject({ phase: "envelope", runtime: "ready" });
      expect(harness.sent).toEqual(["INIT"]);
    });

    it("loads a deferred source only on tap, then creates the iframe", async () => {
      const load = vi.fn(() => Promise.resolve(viewerPayload()));
      const harness = createHarness({ source: { kind: "deferred", load } });

      harness.controller.mounted();
      expect(load).not.toHaveBeenCalled();
      expect(harness.state()).toMatchObject({ frameVisible: false, viewer: null });

      harness.controller.open();
      expect(load).toHaveBeenCalledOnce();
      expect(harness.state().phase).toBe("loading-content");
      await flush();

      expect(harness.state()).toMatchObject({ frameVisible: true, phase: "opening" });
      harness.load();
      harness.ready();
      expect(harness.sent).toEqual(["INIT", "PLAY"]);
      expect(harness.state().phase).toBe("playing");
      expect(harness.events).toEqual([{ type: "opened" }]);
    });

    it("shows the failure and loads again on Thử lại", async () => {
      const load = vi
        .fn<() => Promise<ViewerPayload>>()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(viewerPayload());
      const harness = createHarness({ source: { kind: "deferred", load } });

      harness.controller.open();
      await flush();
      expect(harness.state()).toMatchObject({ phase: "load-failed", viewer: null });
      expect(harness.events).toEqual([]);

      harness.controller.open();
      expect(load).toHaveBeenCalledOnce();
      harness.controller.retry();
      expect(harness.audio.unlock).toHaveBeenCalledTimes(2);
      await flush();
      expect(harness.state()).toMatchObject({ frameVisible: true, phase: "opening" });
      expect(harness.events).toEqual([{ type: "opened" }]);
      harness.controller.retry();
      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  describe("opening", () => {
    it("sends PLAY once when the template is ready", () => {
      const harness = createHarness();
      harness.load();
      harness.ready();

      harness.controller.open();
      harness.controller.open();

      expect(harness.sent).toEqual(["INIT", "PLAY"]);
      expect(harness.state()).toMatchObject({ openRequested: true, phase: "playing" });
    });

    it("holds PLAY after a tap before READY", () => {
      const harness = createHarness();
      harness.load();

      harness.controller.open();
      expect(harness.state().phase).toBe("opening");
      expect(harness.sent).not.toContain("PLAY");

      harness.ready();
      expect(harness.sent).toEqual(["INIT", "PLAY"]);
      expect(harness.state().phase).toBe("playing");
    });

    it("ignores a load before mounted() and counts the one after the URL is set", () => {
      const harness = createHarness();

      harness.attach();
      expect(harness.bridges).toHaveLength(0);
      harness.controller.mounted();
      expect(harness.state().frameSrc).toBe(viewerPayload().artifactUrl);
      harness.attach();
      harness.ready();
      harness.controller.open();

      expect(harness.state()).toMatchObject({ phase: "playing", runtime: "ready" });
      expect(harness.sent).toEqual(["INIT", "PLAY"]);
    });

    it("ignores the load of the initial about:blank document", () => {
      const harness = createHarness();
      harness.controller.mounted();

      harness.attach("about:blank");
      expect(harness.bridges).toHaveLength(0);
      vi.advanceTimersByTime(ARTIFACT_LOAD_TIMEOUT_MS);

      expect(harness.state()).toMatchObject({
        fallbackReason: "LOAD_TIMEOUT",
        runtime: "fallback",
      });
      expect(harness.sent).toEqual([]);
    });

    it("plays nothing without the gesture", () => {
      const harness = createHarness();
      harness.load();
      harness.ready();
      vi.advanceTimersByTime(60_000);

      expect(harness.sent).toEqual(["INIT"]);
      expect(harness.audio.play).not.toHaveBeenCalled();
      expect(harness.audio.unlock).not.toHaveBeenCalled();
    });
  });

  describe("audio", () => {
    it("starts audio inside the opening gesture", () => {
      const harness = createHarness();
      harness.load();
      harness.ready();

      harness.controller.open();

      expect(harness.audioCalls).toEqual([`src:${viewerPayload().audioUrl}`, "play"]);
    });

    it("unlocks deferred audio in the gesture and plays after the load", async () => {
      const harness = createHarness({
        source: { kind: "deferred", load: () => Promise.resolve(viewerPayload()) },
      });

      harness.controller.open();
      expect(harness.audioCalls).toEqual(["unlock"]);
      await flush();

      expect(harness.audioCalls).toEqual(["unlock", `src:${viewerPayload().audioUrl}`, "play"]);
    });

    it("keeps the template running and shows a notice when playback is blocked", async () => {
      const harness = createHarness({ playResult: "blocked" });
      harness.load();
      harness.ready();

      harness.controller.open();
      await flush();

      expect(harness.sent).toEqual(["INIT", "PLAY"]);
      expect(harness.state().audioNotice).toBe(true);
    });

    it("mutes and reports the muted state", () => {
      const harness = createHarness();

      harness.controller.toggleMute();
      expect(harness.state().muted).toBe(true);
      expect(harness.audio.setMuted).toHaveBeenLastCalledWith(true);
      expect(harness.onMutedChange).toHaveBeenLastCalledWith(true);

      harness.controller.toggleMute();
      expect(harness.state().muted).toBe(false);
    });

    it("plays a gift without music and sets no source", () => {
      const harness = createHarness({
        source: { kind: "ready", viewer: viewerPayload({ audioUrl: null }) },
      });
      harness.load();
      harness.ready();
      harness.controller.open();

      expect(harness.audio.setSource).not.toHaveBeenCalled();
      expect(harness.audio.play).not.toHaveBeenCalled();
      expect(harness.sent).toEqual(["INIT", "PLAY"]);
    });
  });

  describe("static fallback", () => {
    it("switches on a runtime error after opening, keeping audio", () => {
      const harness = createHarness();
      harness.load();
      harness.ready();
      harness.controller.open();
      harness.emit({ sceneId: "memory-2", type: "SCENE" });

      harness.emit({ code: "RUNTIME_ERROR", type: "ERROR" });

      expect(harness.sent).toEqual(["INIT", "PLAY", "DESTROY"]);
      expect(harness.state()).toMatchObject({
        fallbackReason: "ERROR",
        frameSrc: null,
        frameVisible: false,
        phase: "playing",
        runtime: "fallback",
      });
      expect(harness.audio.release).not.toHaveBeenCalled();
      expect(harness.events).toEqual([
        { type: "opened" },
        { sceneId: "memory-2", type: "scene" },
        { reason: "ERROR", type: "fallback" },
      ]);
      harness.emit({ protocolVersion: 1, type: "READY" });
      expect(harness.state().runtime).toBe("fallback");
    });

    it("keeps the envelope after an error before opening", () => {
      const harness = createHarness();
      harness.load();
      harness.emit({ code: "INVALID_MESSAGE", type: "ERROR" });

      expect(harness.state()).toMatchObject({ phase: "envelope", runtime: "fallback" });
      harness.controller.open();
      expect(harness.state().phase).toBe("playing");
      expect(harness.sent).toEqual(["INIT", "DESTROY"]);
    });

    it("falls back after 20 INIT attempts without READY", () => {
      const harness = createHarness();
      harness.load();

      vi.advanceTimersByTime(19 * 250);
      expect(harness.state().runtime).toBe("loading");
      vi.advanceTimersByTime(250);

      expect(harness.sent.filter((message) => message === "INIT")).toHaveLength(20);
      expect(harness.state()).toMatchObject({
        fallbackReason: "INIT_TIMEOUT",
        runtime: "fallback",
      });
    });

    it("falls back when the artifact never loads", () => {
      const harness = createHarness();
      harness.controller.mounted();

      vi.advanceTimersByTime(ARTIFACT_LOAD_TIMEOUT_MS);

      expect(harness.state()).toMatchObject({
        fallbackReason: "LOAD_TIMEOUT",
        runtime: "fallback",
      });
      harness.attach();
      expect(harness.bridges).toHaveLength(0);
    });

    it("renders statically without an iframe when there is no artifact", async () => {
      const harness = createHarness({
        source: { kind: "ready", viewer: viewerPayload({ artifactUrl: null }) },
      });

      expect(harness.state().frameVisible).toBe(false);
      harness.controller.mounted();
      await flush();
      harness.controller.open();

      expect(harness.bridges).toHaveLength(0);
      expect(harness.state()).toMatchObject({ fallbackReason: "NO_ARTIFACT", phase: "playing" });
      expect(harness.events).toEqual([
        { reason: "NO_ARTIFACT", type: "fallback" },
        { type: "opened" },
      ]);
    });

    it("reports no fallback from a controller discarded right after mounting", async () => {
      const harness = createHarness({
        source: { kind: "ready", viewer: viewerPayload({ artifactUrl: null }) },
      });

      harness.controller.mounted();
      harness.controller.dispose();
      await flush();

      expect(harness.events).toEqual([]);
    });

    it("falls back at once for a deferred payload without an artifact", async () => {
      const harness = createHarness({
        source: {
          kind: "deferred",
          load: () => Promise.resolve(viewerPayload({ artifactUrl: null })),
        },
      });

      harness.controller.open();
      await flush();

      expect(harness.state()).toMatchObject({
        frameVisible: false,
        phase: "playing",
        runtime: "fallback",
      });
    });

    it("refreshes expired URLs of a ready source once through the host", () => {
      const harness = createHarness();
      harness.load();
      harness.ready();
      harness.controller.open();
      vi.advanceTimersByTime(6 * 60 * 1000);

      harness.emit({ code: "RUNTIME_ERROR", type: "ERROR" });
      expect(harness.onAssetsExpired).toHaveBeenCalledOnce();
      expect(harness.state().phase).toBe("playing");

      const fresh = viewerPayload({
        assets: { [assetIds[0]]: "https://blob.example/fresh/0" },
        assetsExpireAt: "2026-10-01T10:11:00.000Z",
      });
      harness.controller.updateViewer(fresh);
      expect(harness.state().viewer?.assets).toEqual(fresh.assets);
      expect(harness.state().viewer?.payload).toEqual(viewerPayload().payload);

      harness.controller.imageFailed(assetIds[0]);
      harness.controller.imageFailed(assetIds[0]);
      expect(harness.onAssetsExpired).toHaveBeenCalledOnce();
      expect(harness.state().failedImages).toEqual([assetIds[0]]);
    });

    it("refreshes expired URLs of a deferred source by loading again", async () => {
      const load = vi
        .fn<() => Promise<ViewerPayload>>()
        .mockResolvedValueOnce(viewerPayload())
        .mockResolvedValueOnce(
          viewerPayload({
            assets: { [assetIds[1]]: "https://blob.example/fresh/1" },
            assetsExpireAt: "2026-10-01T10:12:00.000Z",
            payload: { "receiver-name": "Không dùng" },
          }),
        );
      const harness = createHarness({ source: { kind: "deferred", load } });
      harness.controller.open();
      await flush();
      harness.load();
      harness.ready();
      harness.emit({ code: "RUNTIME_ERROR", type: "ERROR" });

      vi.advanceTimersByTime(6 * 60 * 1000);
      harness.controller.imageFailed(assetIds[1]);
      await flush();

      expect(load).toHaveBeenCalledTimes(2);
      expect(harness.state().viewer?.assets).toEqual({
        [assetIds[1]]: "https://blob.example/fresh/1",
      });
      expect(harness.state().viewer?.payload).toEqual(viewerPayload().payload);
      harness.controller.imageFailed(assetIds[1]);
      expect(harness.state().failedImages).toEqual([assetIds[1]]);
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("shows the caption when the refresh of a deferred source fails", async () => {
      const load = vi
        .fn<() => Promise<ViewerPayload>>()
        .mockResolvedValueOnce(viewerPayload())
        .mockRejectedValueOnce(new Error("offline"));
      const harness = createHarness({ source: { kind: "deferred", load } });
      harness.controller.open();
      await flush();
      harness.load();
      harness.ready();
      harness.emit({ code: "RUNTIME_ERROR", type: "ERROR" });

      vi.advanceTimersByTime(6 * 60 * 1000);
      harness.controller.imageFailed(assetIds[1]);
      // A second failure of the same image waits for the refresh it triggered.
      harness.controller.imageFailed(assetIds[1]);
      expect(harness.state().failedImages).toEqual([]);
      await flush();

      expect(load).toHaveBeenCalledTimes(2);
      expect(harness.state().failedImages).toEqual([assetIds[1]]);
    });

    it("shows the caption when the host of a ready source never refreshes", () => {
      const harness = createHarness();
      harness.load();
      harness.ready();
      harness.controller.open();
      harness.emit({ code: "RUNTIME_ERROR", type: "ERROR" });

      vi.advanceTimersByTime(6 * 60 * 1000);
      harness.controller.imageFailed(assetIds[0]);
      expect(harness.onAssetsExpired).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(ASSET_REFRESH_TIMEOUT_MS - 1);
      expect(harness.state().failedImages).toEqual([]);
      vi.advanceTimersByTime(1);

      expect(harness.state().failedImages).toEqual([assetIds[0]]);
    });

    it("shows the caption for an image that fails before expiry", () => {
      const harness = createHarness({
        source: { kind: "ready", viewer: viewerPayload({ artifactUrl: null }) },
      });
      harness.controller.mounted();
      harness.controller.open();

      harness.controller.imageFailed(assetIds[2]);

      expect(harness.onAssetsExpired).not.toHaveBeenCalled();
      expect(harness.state().failedImages).toEqual([assetIds[2]]);
    });
  });

  describe("visibility", () => {
    it("pauses during the gift and resumes only on Tiếp tục", async () => {
      const harness = createHarness();
      harness.load();
      harness.ready();
      harness.controller.open();
      harness.emit({ sceneId: "memory-2", type: "SCENE" });

      harness.controller.setHidden(true);
      expect(harness.sent).toEqual(["INIT", "PLAY", "PAUSE"]);
      expect(harness.audio.pause).toHaveBeenCalledOnce();
      expect(harness.state().phase).toBe("paused");

      harness.controller.setHidden(false);
      expect(harness.state().phase).toBe("paused");
      harness.controller.resume();
      await flush();
      expect(harness.sent).toEqual(["INIT", "PLAY", "PAUSE", "PLAY"]);
      expect(harness.audio.play).toHaveBeenCalledTimes(2);
      expect(harness.state().phase).toBe("playing");
    });

    it("waits as paused when hidden while a ready source is opening", async () => {
      const harness = createHarness();
      harness.load();
      harness.controller.open();
      expect(harness.state().phase).toBe("opening");

      harness.controller.setHidden(true);
      harness.ready();

      expect(harness.state().phase).toBe("paused");
      expect(harness.sent).toEqual(["INIT"]);
      expect(harness.audioCalls).toEqual([`src:${viewerPayload().audioUrl}`, "play", "pause"]);
      harness.controller.setHidden(false);
      expect(harness.state().phase).toBe("paused");

      harness.controller.resume();
      await flush();
      expect(harness.sent).toEqual(["INIT", "PLAY"]);
      expect(harness.audio.play).toHaveBeenCalledTimes(2);
      expect(harness.state().phase).toBe("playing");
    });

    it("waits as paused when hidden while a deferred source is loading", async () => {
      const harness = createHarness({
        source: { kind: "deferred", load: () => Promise.resolve(viewerPayload()) },
      });
      harness.controller.open();
      expect(harness.state().phase).toBe("loading-content");

      harness.controller.setHidden(true);
      await flush();
      expect(harness.state().phase).toBe("opening");
      harness.load();
      harness.ready();

      expect(harness.state().phase).toBe("paused");
      expect(harness.sent).toEqual(["INIT"]);
      expect(harness.audioCalls).toEqual(["unlock", "pause", `src:${viewerPayload().audioUrl}`]);

      harness.controller.resume();
      await flush();
      expect(harness.sent).toEqual(["INIT", "PLAY"]);
      expect(harness.audio.play).toHaveBeenCalledOnce();
      expect(harness.state().phase).toBe("playing");
    });

    it("waits as paused when a hidden opening ends in the static rendering", async () => {
      const harness = createHarness({
        source: {
          kind: "deferred",
          load: () => Promise.resolve(viewerPayload({ artifactUrl: null })),
        },
      });
      harness.controller.open();
      harness.controller.setHidden(true);
      await flush();

      expect(harness.state()).toMatchObject({ phase: "paused", runtime: "fallback" });
      expect(harness.audio.play).not.toHaveBeenCalled();
      harness.controller.resume();
      expect(harness.state().phase).toBe("playing");
      expect(harness.audio.play).toHaveBeenCalledOnce();
    });

    it("waits as paused when the template fails while a hidden gift is opening", () => {
      const harness = createHarness();
      harness.load();
      harness.controller.open();
      harness.controller.setHidden(true);

      harness.emit({ code: "RUNTIME_ERROR", type: "ERROR" });

      expect(harness.state()).toMatchObject({ phase: "paused", runtime: "fallback" });
      expect(harness.sent).toEqual(["INIT", "DESTROY"]);
    });

    it("forgets a hidden opening after a failed load and a new tap", async () => {
      const load = vi
        .fn<() => Promise<ViewerPayload>>()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(viewerPayload());
      const harness = createHarness({ source: { kind: "deferred", load } });
      harness.controller.open();
      harness.controller.setHidden(true);
      await flush();
      expect(harness.state().phase).toBe("load-failed");

      harness.controller.retry();
      await flush();
      harness.load();
      harness.ready();

      expect(harness.state().phase).toBe("playing");
      expect(harness.sent).toEqual(["INIT", "PLAY"]);
    });

    it("resumes the music after COMPLETE when the page is visible again (Hidden after the gift completed)", async () => {
      const harness = createHarness();
      harness.load();
      harness.ready();
      harness.controller.open();
      harness.emit({ type: "COMPLETE" });
      expect(harness.state().phase).toBe("complete");
      harness.audioCalls.length = 0;

      harness.controller.setHidden(true);
      harness.controller.setHidden(false);
      await flush();

      expect(harness.audioCalls).toEqual(["pause", "play"]);
      expect(harness.sent).toEqual(["INIT", "PLAY"]);
      expect(harness.state().phase).toBe("complete");
      // Visible again without a pause before it: nothing to resume.
      harness.controller.setHidden(false);
      expect(harness.audioCalls).toEqual(["pause", "play"]);
    });

    it("only pauses audio while the envelope is shown", () => {
      const harness = createHarness();
      harness.load();
      harness.ready();

      harness.controller.setHidden(true);
      harness.controller.resume();

      expect(harness.sent).toEqual(["INIT"]);
      expect(harness.audio.pause).toHaveBeenCalledOnce();
      expect(harness.state().phase).toBe("envelope");
    });
  });

  it("sends prefersReducedMotion when the host forces it", () => {
    const harness = createHarness({ forceReducedMotion: true });
    harness.load();

    expect(harness.inits[0]?.prefersReducedMotion).toBe(true);
    expect(harness.inits[0]?.assets).toEqual(viewerPayload().assets);
  });

  it("follows the system reduced-motion preference", () => {
    const harness = createHarness({ systemPrefersReducedMotion: () => true });
    harness.load();

    expect(harness.inits[0]?.prefersReducedMotion).toBe(true);
  });

  describe("issues", () => {
    it("reports each distinct issue once, in field order", () => {
      const harness = createHarness();
      harness.load();
      harness.ready();
      const assetIssue = {
        code: "ASSET_UNAVAILABLE",
        fieldId: "memories",
        itemIndex: 1,
        protocolVersion: 1,
        type: "ISSUE",
      } as const;

      harness.emit(assetIssue);
      harness.emit(assetIssue);
      harness.emit({
        code: "CONTENT_MISSING",
        fieldId: "unknown-field",
        protocolVersion: 1,
        type: "ISSUE",
      });
      harness.emit({
        code: "CONTENT_MISSING",
        fieldId: "receiver-name",
        protocolVersion: 1,
        type: "ISSUE",
      });

      expect(harness.onIssuesChange).toHaveBeenCalledTimes(3);
      expect(harness.onIssuesChange).toHaveBeenLastCalledWith([
        { code: "CONTENT_MISSING", fieldId: "receiver-name" },
        { code: "ASSET_UNAVAILABLE", fieldId: "memories", itemIndex: 1 },
        { code: "CONTENT_MISSING", fieldId: "unknown-field" },
      ]);
      expect(harness.state().phase).toBe("envelope");
    });

    it("keeps the set across handshake retries and a new load", () => {
      const harness = createHarness();
      harness.load();
      harness.emit({
        code: "CONTENT_MISSING",
        fieldId: "final-letter",
        protocolVersion: 1,
        type: "ISSUE",
      });
      vi.advanceTimersByTime(500);
      harness.attach();
      harness.emit({
        code: "CONTENT_MISSING",
        fieldId: "final-letter",
        protocolVersion: 1,
        type: "ISSUE",
      });

      expect(harness.onIssuesChange).toHaveBeenCalledOnce();
    });
  });

  it("notifies a full play-through in order, once", () => {
    const harness = createHarness();
    harness.load();
    harness.ready();
    harness.controller.open();
    harness.emit({ sceneId: "opening", type: "SCENE" });
    harness.emit({ sceneId: "memory-1", type: "SCENE" });
    harness.emit({ type: "COMPLETE" });
    harness.emit({ type: "COMPLETE" });

    expect(harness.events).toEqual([
      { type: "opened" },
      { sceneId: "opening", type: "scene" },
      { sceneId: "memory-1", type: "scene" },
      { type: "completed" },
    ]);
    expect(harness.state().phase).toBe("complete");
    harness.controller.setHidden(true);
    expect(harness.sent).not.toContain("PAUSE");
  });

  describe("handshake", () => {
    it("does not fall back when a slow artifact loads after 8 seconds", () => {
      const harness = createHarness();
      harness.controller.mounted();
      vi.advanceTimersByTime(8000);

      harness.attach();
      vi.advanceTimersByTime(19 * 250);
      harness.ready();
      vi.advanceTimersByTime(ARTIFACT_LOAD_TIMEOUT_MS);

      expect(harness.state().runtime).toBe("ready");
      expect(harness.events).toEqual([]);
    });

    it("starts a new budget on every iframe load", () => {
      const harness = createHarness();
      harness.load();
      vi.advanceTimersByTime(15 * 250);
      harness.attach();
      vi.advanceTimersByTime(15 * 250);

      expect(harness.state().runtime).toBe("loading");
      expect(harness.bridges[0]?.disconnect).toHaveBeenCalledOnce();
    });
  });

  it("destroys the runtime, stops listening and releases audio on unmount", () => {
    const harness = createHarness();
    harness.load();
    harness.controller.open();
    const listener = vi.fn();
    harness.controller.subscribe(listener);

    harness.controller.dispose();
    harness.ready();
    harness.controller.dispose();
    vi.advanceTimersByTime(60_000);

    expect(harness.sent).toEqual(["INIT", "DESTROY"]);
    expect(harness.audio.release).toHaveBeenCalledOnce();
    expect(harness.state().phase).toBe("destroyed");
    expect(listener).toHaveBeenCalledOnce();
    harness.controller.open();
    harness.controller.toggleMute();
    harness.controller.imageFailed(assetIds[0]);
    harness.controller.setHidden(true);
    harness.controller.mounted();
    expect(harness.state().phase).toBe("destroyed");
  });

  it("ignores results of a deferred load that finishes after unmount", async () => {
    const harness = createHarness({
      source: { kind: "deferred", load: () => Promise.resolve(viewerPayload()) },
    });
    harness.controller.open();
    harness.controller.dispose();
    await flush();

    expect(harness.state()).toMatchObject({ phase: "destroyed", viewer: null });
  });

  it("builds the pre-controller state from the source", () => {
    const deferred: ViewerSource = {
      kind: "deferred",
      load: () => Promise.resolve(viewerPayload()),
    };

    expect(initialGiftViewerState(deferred, true)).toMatchObject({
      frameVisible: false,
      muted: true,
      phase: "envelope",
      viewer: null,
    });
  });
});

describe("gift viewer host", () => {
  it("serves the initial state until a controller connects, and disposes on disconnect", () => {
    const initial = initialGiftViewerState({ kind: "ready", viewer: viewerPayload() }, false);
    const host = createGiftViewerHost(initial);
    const listener = vi.fn();
    const unsubscribe = host.subscribe(listener);
    expect(host.getState()).toBe(initial);
    expect(host.current()).toBeNull();

    const first = createHarness().controller;
    host.connect(first);
    expect(listener).toHaveBeenCalledOnce();
    expect(host.current()).toBe(first);
    first.toggleMute();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(host.getState().muted).toBe(true);

    const second = createHarness().controller;
    host.connect(second);
    expect(first.getState().phase).toBe("destroyed");
    host.disconnect();
    expect(second.getState().phase).toBe("destroyed");
    expect(host.getState()).toBe(initial);
    host.disconnect();

    unsubscribe();
    second.toggleMute();
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe("window template bridge", () => {
  it("accepts only schema-valid events from the gift viewer's own iframe", () => {
    const listeners = new Set<(event: MessageEvent<unknown>) => void>();
    const host = {
      addEventListener: vi.fn((_type: string, listener: (event: MessageEvent<unknown>) => void) =>
        listeners.add(listener),
      ),
      removeEventListener: vi.fn(
        (_type: string, listener: (event: MessageEvent<unknown>) => void) =>
          listeners.delete(listener),
      ),
    } as unknown as Pick<Window, "addEventListener" | "removeEventListener">;
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as TemplateWindow;
    const other = { postMessage: vi.fn() } as unknown as TemplateWindow;
    const received: TemplateEvent[] = [];
    const bridge = createWindowTemplateBridge(host)(target, (event) => received.push(event));
    bridge.start();
    const issue = {
      code: "ASSET_UNAVAILABLE",
      fieldId: "memories",
      itemIndex: 1,
      protocolVersion: 1,
      type: "ISSUE",
    };
    const dispatch = (source: unknown, data: unknown) => {
      for (const listener of listeners) listener({ data, source } as MessageEvent<unknown>);
    };

    dispatch(other, issue);
    dispatch(target, { ...issue, text: "An" });
    dispatch(target, issue);
    bridge.play();
    bridge.destroy();
    dispatch(target, issue);

    expect(received).toEqual([issue]);
    expect(postMessage).toHaveBeenCalledWith({ type: "PLAY" }, "*");
    expect(postMessage).toHaveBeenLastCalledWith({ type: "DESTROY" }, "*");
    expect(listeners.size).toBe(0);
  });
});

describe("element audio", () => {
  it("drives a media element and ignores the unlock rejection", async () => {
    const element = {
      load: vi.fn(),
      muted: false,
      pause: vi.fn(),
      play: vi.fn(() => Promise.reject(new DOMException("no source", "NotSupportedError"))),
      removeAttribute: vi.fn(),
      src: "",
    };
    const audio = createElementAudio(element);

    audio.unlock();
    audio.setSource("/audio-library/a.mp3");
    audio.setMuted(true);
    await expect(audio.play()).resolves.toBe("failed");
    audio.pause();
    audio.release();

    expect(element.src).toBe("/audio-library/a.mp3");
    expect(element.muted).toBe(true);
    expect(element.pause).toHaveBeenCalledTimes(2);
    expect(element.removeAttribute).toHaveBeenCalledWith("src");
    expect(element.load).toHaveBeenCalledOnce();
  });

  it("survives a synchronous unlock failure", () => {
    const element = {
      load: vi.fn(),
      muted: false,
      pause: vi.fn(),
      play: vi.fn(() => {
        throw new Error("not implemented");
      }),
      removeAttribute: vi.fn(),
      src: "",
    };

    expect(() => createElementAudio(element).unlock()).not.toThrow();
  });
});
