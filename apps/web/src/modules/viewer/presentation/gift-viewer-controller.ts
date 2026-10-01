import {
  type AudioPlaybackResult,
  createMediaElementAudioController,
  createTemplateBridge,
  readTrustedTemplateEvent,
  type TemplateEvent,
  type TemplateMessagePayload,
} from "@love-memory/template-sdk";

import {
  issueKey,
  type ViewerFallbackReason,
  type ViewerIssue,
  type ViewerLifecycleEvent,
  type ViewerPayload,
  type ViewerSource,
} from "../application/viewer-payload";

/** `INIT` is resent every 250 ms, at most 20 times after each iframe `load`. */
export const HANDSHAKE_INTERVAL_MS = 250;
export const HANDSHAKE_MAX_ATTEMPTS = 20;
/** An artifact that has not loaded 15 s after it received its URL is treated as broken. */
export const ARTIFACT_LOAD_TIMEOUT_MS = 15_000;
/** A ready source's host page that has not delivered fresh asset URLs after 10 s has failed. */
export const ASSET_REFRESH_TIMEOUT_MS = 10_000;

export type GiftViewerPhase =
  | "complete"
  | "destroyed"
  | "envelope"
  | "load-failed"
  | "loading-content"
  | "opening"
  | "paused"
  | "playing";

export type GiftViewerRuntime = "fallback" | "idle" | "loading" | "ready";

export type GiftViewerState = Readonly<{
  assetsRefreshed: boolean;
  /** Shown as `Không phát được nhạc.` when playback was blocked or failed. */
  audioNotice: boolean;
  /** Asset ids whose static image failed for good; the caption is shown instead. */
  failedImages: readonly string[];
  fallbackReason: ViewerFallbackReason | null;
  /** The iframe artifact URL, set only after the client `load` listener is attached. */
  frameSrc: string | null;
  /** Whether the iframe element exists. A deferred source creates it only after its load. */
  frameVisible: boolean;
  muted: boolean;
  openRequested: boolean;
  phase: GiftViewerPhase;
  runtime: GiftViewerRuntime;
  viewer: ViewerPayload | null;
}>;

/** The template side, as the SDK bridge exposes it. */
export type GiftViewerBridge = Readonly<{
  destroy: () => void;
  disconnect: () => void;
  initialize: (
    payload: TemplateMessagePayload,
    prefersReducedMotion: boolean,
    assets: Readonly<Record<string, string>>,
  ) => void;
  pause: () => void;
  play: () => void;
  start: () => void;
}>;

/** The iframe's window: the only accepted source of template events and target of commands. */
export type TemplateWindow = MessageEventSource & Readonly<{ postMessage: Window["postMessage"] }>;

export type CreateGiftViewerBridge = (
  target: TemplateWindow,
  onEvent: (event: TemplateEvent) => void,
) => GiftViewerBridge;

export type GiftViewerAudio = Readonly<{
  pause: () => void;
  play: () => Promise<AudioPlaybackResult>;
  /** Pauses, removes the source and resets the element. */
  release: () => void;
  setMuted: (muted: boolean) => void;
  setSource: (url: string) => void;
  /** Calls playback on the source-less element inside a gesture, so later playback is allowed. */
  unlock: () => void;
}>;

export type GiftViewerControllerOptions = Readonly<{
  audio: GiftViewerAudio;
  createBridge: CreateGiftViewerBridge;
  forceReducedMotion: boolean;
  muted: boolean;
  now?: () => number;
  onAssetsExpired?: () => void;
  onIssuesChange?: (issues: readonly ViewerIssue[]) => void;
  onLifecycleEvent?: (event: ViewerLifecycleEvent) => void;
  onMutedChange?: (muted: boolean) => void;
  source: ViewerSource;
  systemPrefersReducedMotion: () => boolean;
}>;

/** The state a gift viewer renders before its controller exists (server render, hydration). */
export function initialGiftViewerState(source: ViewerSource, muted: boolean): GiftViewerState {
  const viewer = source.kind === "ready" ? source.viewer : null;
  return {
    assetsRefreshed: false,
    audioNotice: false,
    failedImages: [],
    fallbackReason: null,
    frameSrc: null,
    frameVisible: typeof viewer?.artifactUrl === "string",
    muted,
    openRequested: false,
    phase: "envelope",
    runtime: "idle",
    viewer,
  };
}

/** The production bridge: commands to `target`, and only schema-valid events from `target`. */
export function createWindowTemplateBridge(
  host: Pick<Window, "addEventListener" | "removeEventListener">,
): CreateGiftViewerBridge {
  return (target, onEvent) =>
    createTemplateBridge({
      onEvent,
      postMessage: (message) => target.postMessage(message, "*"),
      subscribe: (listener) => {
        const onMessage = (event: MessageEvent<unknown>) => {
          const trusted = readTrustedTemplateEvent(event, target);
          if (trusted) listener(trusted);
        };
        host.addEventListener("message", onMessage);
        return () => host.removeEventListener("message", onMessage);
      },
    });
}

type AudioElement = Parameters<typeof createMediaElementAudioController>[0] &
  Pick<HTMLMediaElement, "src">;

export function createElementAudio(element: AudioElement): GiftViewerAudio {
  const controller = createMediaElementAudioController(element);
  return {
    pause: () => controller.pause(),
    play: () => controller.play(),
    release: () => controller.destroy(),
    setMuted: (muted) => {
      element.muted = muted;
    },
    setSource: (url) => {
      element.src = url;
    },
    unlock: () => {
      try {
        // The element has no source yet, so this rejection is expected and ignored.
        void Promise.resolve(element.play()).catch(() => undefined);
      } catch {
        // Some browsers throw synchronously instead; the gesture still counts.
      }
    },
  };
}

function isExpired(viewer: ViewerPayload | null, now: number): boolean {
  const expiresAt = viewer?.assetsExpireAt;
  return typeof expiresAt === "string" && now >= Date.parse(expiresAt);
}

/**
 * The gift viewer's host state machine: envelope and tap-to-open, the handshake with the sandboxed
 * template, audio, visibility, issues, lifecycle notifications and the static fallback. It holds no
 * DOM; the component binds events to it and renders its state.
 */
export function createGiftViewerController(options: GiftViewerControllerOptions) {
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();
  const issues = new Map<string, ViewerIssue>();
  let state = initialGiftViewerState(options.source, options.muted);
  let bridge: GiftViewerBridge | null = null;
  let handshakeTimer: ReturnType<typeof setInterval> | null = null;
  let loadTimer: ReturnType<typeof setTimeout> | null = null;
  let audioSourceSet = false;
  let completed = false;
  let disposed = false;
  let loadGeneration = 0;
  /**
   * The page was hidden after the gesture but before the gift started playing. The gift then waits
   * as `paused` for `Tiếp tục` instead of starting the template or audio in a background tab.
   */
  let hiddenBeforePlay = false;
  /** Hiding the page after `COMPLETE` paused the music the opening gesture had started. */
  let audioPausedAfterComplete = false;
  /** Images whose failure triggered the asset refresh: they show their caption if it fails. */
  const refreshTriggers = new Set<string>();
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  function update(patch: Partial<GiftViewerState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  function emit(event: ViewerLifecycleEvent) {
    options.onLifecycleEvent?.(event);
  }

  function stopHandshake() {
    if (handshakeTimer !== null) clearInterval(handshakeTimer);
    handshakeTimer = null;
  }

  function stopLoadTimer() {
    if (loadTimer !== null) clearTimeout(loadTimer);
    loadTimer = null;
  }

  function prefersReducedMotion(): boolean {
    return options.forceReducedMotion || options.systemPrefersReducedMotion();
  }

  function startAudio() {
    if (!state.viewer?.audioUrl) return;
    void options.audio.play().then((result) => {
      if (result !== "playing" && !disposed) update({ audioNotice: true });
    });
  }

  /** The refresh failed: every image that triggered it shows its caption instead. */
  function refreshFailed() {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = null;
    if (disposed || refreshTriggers.size === 0) return;
    const failed = [...refreshTriggers].filter((id) => !state.failedImages.includes(id));
    refreshTriggers.clear();
    if (failed.length > 0) update({ failedImages: [...state.failedImages, ...failed] });
  }

  function refreshAssets() {
    if (state.assetsRefreshed) return;
    update({ assetsRefreshed: true });
    if (options.source.kind === "ready") {
      options.onAssetsExpired?.();
      // The host page answers through `updateViewer`; without an answer the images stay broken.
      refreshTimer = setTimeout(refreshFailed, ASSET_REFRESH_TIMEOUT_MS);
      return;
    }
    options.source.load().then(
      (fresh) => {
        if (!disposed) replaceAssets(fresh);
      },
      () => refreshFailed(),
    );
  }

  function replaceAssets(fresh: ViewerPayload) {
    if (!state.viewer) return;
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = null;
    refreshTriggers.clear();
    update({
      failedImages: [],
      viewer: { ...state.viewer, assets: fresh.assets, assetsExpireAt: fresh.assetsExpireAt },
    });
  }

  /** The static rendering becomes visible: get fresh image URLs once when the old ones expired. */
  function staticShown() {
    if (isExpired(state.viewer, now())) refreshAssets();
  }

  /** The template (when ready) or the static rendering starts, unless the page was hidden. */
  function beginPlayback() {
    if (hiddenBeforePlay) {
      update({ phase: "paused" });
      return;
    }
    if (state.runtime === "ready") bridge?.play();
    update({ phase: "playing" });
  }

  function emitDeferred(event: ViewerLifecycleEvent) {
    // A controller that React discards right after mounting (Strict Mode) never reports it.
    queueMicrotask(() => {
      if (!disposed) emit(event);
    });
  }

  function switchToFallback(
    reason: ViewerFallbackReason,
    { deferEmit = false }: Readonly<{ deferEmit?: boolean }> = {},
  ) {
    if (disposed || state.runtime === "fallback") return;
    stopHandshake();
    stopLoadTimer();
    bridge?.destroy();
    bridge = null;
    const opening = state.phase === "opening";
    update({ fallbackReason: reason, frameSrc: null, frameVisible: false, runtime: "fallback" });
    if (opening) beginPlayback();
    if (deferEmit) emitDeferred({ reason, type: "fallback" });
    else emit({ reason, type: "fallback" });
    if (state.phase !== "envelope") staticShown();
  }

  function sortedIssues(): ViewerIssue[] {
    const fieldIds = state.viewer?.fields.map((field) => field.id) ?? [];
    const position = (fieldId: string) => {
      const index = fieldIds.indexOf(fieldId);
      return index === -1 ? fieldIds.length : index;
    };
    return [...issues.values()].sort(
      (left, right) =>
        position(left.fieldId) - position(right.fieldId) ||
        (left.itemIndex ?? -1) - (right.itemIndex ?? -1),
    );
  }

  function handleEvent(event: TemplateEvent) {
    if (disposed || state.runtime === "fallback") return;
    switch (event.type) {
      case "READY":
        stopHandshake();
        update({ runtime: "ready" });
        if (state.openRequested && state.phase === "opening") beginPlayback();
        return;
      case "SCENE":
        emit({ sceneId: event.sceneId, type: "scene" });
        return;
      case "COMPLETE":
        if (state.phase === "playing") update({ phase: "complete" });
        if (!completed) {
          completed = true;
          emit({ type: "completed" });
        }
        return;
      case "ERROR":
        switchToFallback("ERROR");
        return;
      case "ISSUE": {
        const issue: ViewerIssue =
          event.itemIndex === undefined
            ? { code: event.code, fieldId: event.fieldId }
            : { code: event.code, fieldId: event.fieldId, itemIndex: event.itemIndex };
        const key = issueKey(issue);
        if (issues.has(key)) return;
        issues.set(key, issue);
        options.onIssuesChange?.(sortedIssues());
        return;
      }
    }
  }

  /** Content is available after the gesture: play the template when ready, or the static view. */
  function presentOpened() {
    emit({ type: "opened" });
    if (state.runtime === "ready") {
      beginPlayback();
    } else if (state.runtime === "fallback") {
      beginPlayback();
      staticShown();
    } else {
      update({ phase: "opening" });
    }
  }

  function loadDeferred() {
    if (options.source.kind !== "deferred") return;
    // Inside the gesture: unlock audio before the asynchronous load.
    options.audio.unlock();
    hiddenBeforePlay = false;
    update({ openRequested: true, phase: "loading-content" });
    const generation = ++loadGeneration;
    options.source.load().then(
      (viewer) => {
        if (disposed || generation !== loadGeneration) return;
        update({ frameVisible: viewer.artifactUrl !== null, viewer });
        if (viewer.artifactUrl === null) switchToFallback("NO_ARTIFACT");
        if (viewer.audioUrl) {
          options.audio.setSource(viewer.audioUrl);
          if (!hiddenBeforePlay) startAudio();
        }
        presentOpened();
      },
      () => {
        if (disposed || generation !== loadGeneration) return;
        update({ openRequested: false, phase: "load-failed" });
      },
    );
  }

  return {
    getState: (): GiftViewerState => state,

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * Called by the component once mounted on the client. It sets the artifact URL, and the
     * component then creates the iframe with that URL and its `load` listener already attached, so
     * no load (and no initial `about:blank` load) is missed. The load timeout starts now.
     */
    mounted() {
      if (disposed) return;
      const viewer = state.viewer;
      if (!viewer) return;
      if (options.source.kind === "ready" && viewer.audioUrl && !audioSourceSet) {
        audioSourceSet = true;
        options.audio.setSource(viewer.audioUrl);
      }
      if (viewer.artifactUrl === null) {
        switchToFallback("NO_ARTIFACT", { deferEmit: true });
        return;
      }
      if (state.runtime !== "idle") return;
      update({ frameSrc: viewer.artifactUrl, runtime: "loading" });
      loadTimer = setTimeout(() => switchToFallback("LOAD_TIMEOUT"), ARTIFACT_LOAD_TIMEOUT_MS);
    },

    /**
     * The iframe's `load` event: a new handshake with a new budget of 20 attempts. `src` is the
     * iframe's current `src` attribute; a load of anything else (the initial `about:blank`) is
     * ignored, so it neither stops the load timeout nor starts a handshake.
     */
    attach(target: TemplateWindow | null, src: string | null) {
      if (disposed || !target || state.frameSrc === null || state.runtime === "fallback") return;
      if (src !== state.frameSrc) return;
      const viewer = state.viewer;
      if (!viewer) return;
      stopLoadTimer();
      stopHandshake();
      bridge?.disconnect();
      const current = options.createBridge(target, handleEvent);
      bridge = current;
      current.start();
      const initialize = () =>
        current.initialize(
          viewer.payload as TemplateMessagePayload,
          prefersReducedMotion(),
          viewer.assets,
        );
      initialize();
      let attempts = 1;
      handshakeTimer = setInterval(() => {
        if (attempts >= HANDSHAKE_MAX_ATTEMPTS) {
          switchToFallback("INIT_TIMEOUT");
          return;
        }
        attempts += 1;
        initialize();
      }, HANDSHAKE_INTERVAL_MS);
      update({ runtime: "loading" });
    },

    /** `Mở quà`: runs inside the click handler, so audio starts within the gesture. */
    open() {
      if (disposed || state.phase !== "envelope") return;
      if (options.source.kind === "deferred") {
        loadDeferred();
        return;
      }
      hiddenBeforePlay = false;
      update({ openRequested: true });
      startAudio();
      presentOpened();
    },

    /** `Thử lại` after a failed deferred load; also inside its own gesture. */
    retry() {
      if (disposed || state.phase !== "load-failed") return;
      loadDeferred();
    },

    /** `Tiếp tục` after the page was hidden during the gift or while it was opening. */
    resume() {
      if (disposed || state.phase !== "paused") return;
      hiddenBeforePlay = false;
      if (state.runtime === "ready") bridge?.play();
      startAudio();
      update({ phase: "playing" });
    },

    setHidden(hidden: boolean) {
      if (disposed) return;
      if (!hidden) {
        // The finale has no `Tiếp tục`: the music paused by hiding the page resumes by itself.
        if (audioPausedAfterComplete) {
          audioPausedAfterComplete = false;
          startAudio();
        }
        return;
      }
      options.audio.pause();
      if (state.phase === "opening" || state.phase === "loading-content") {
        hiddenBeforePlay = true;
      } else if (state.phase === "playing") {
        if (state.runtime === "ready") bridge?.pause();
        update({ phase: "paused" });
      } else if (state.phase === "complete" && state.viewer?.audioUrl) {
        audioPausedAfterComplete = true;
      }
    },

    toggleMute() {
      if (disposed) return;
      const muted = !state.muted;
      options.audio.setMuted(muted);
      update({ muted });
      options.onMutedChange?.(muted);
    },

    /** A static image failed: after `assetsExpireAt`, fresh URLs are fetched once. */
    imageFailed(assetId: string) {
      if (disposed || state.failedImages.includes(assetId)) return;
      if (!state.assetsRefreshed && isExpired(state.viewer, now())) {
        refreshTriggers.add(assetId);
        refreshAssets();
        return;
      }
      // Still waiting for the refresh this image triggered: it decides.
      if (refreshTriggers.has(assetId)) return;
      update({ failedImages: [...state.failedImages, assetId] });
    },

    /** A ready source's host passed a refreshed payload: take its fresh asset URLs only. */
    updateViewer(viewer: ViewerPayload) {
      if (disposed || viewer === state.viewer) return;
      replaceAssets(viewer);
    },

    dispose() {
      if (disposed) return;
      stopHandshake();
      stopLoadTimer();
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      refreshTimer = null;
      bridge?.destroy();
      bridge = null;
      options.audio.release();
      update({ frameSrc: null, phase: "destroyed" });
      disposed = true;
      listeners.clear();
    },
  } as const;
}

export type GiftViewerController = ReturnType<typeof createGiftViewerController>;

/**
 * Holds the controller of the current mount for `useSyncExternalStore`. A disposed controller is
 * final, so React's development double mount connects a fresh one instead of reusing it.
 */
export function createGiftViewerHost(initialState: GiftViewerState) {
  const listeners = new Set<() => void>();
  let controller: GiftViewerController | null = null;
  let unsubscribe: (() => void) | null = null;

  function notify() {
    for (const listener of listeners) listener();
  }

  return {
    connect(next: GiftViewerController) {
      unsubscribe?.();
      controller?.dispose();
      controller = next;
      unsubscribe = next.subscribe(notify);
      notify();
    },
    current: (): GiftViewerController | null => controller,
    disconnect() {
      unsubscribe?.();
      unsubscribe = null;
      controller?.dispose();
      controller = null;
    },
    getState: (): GiftViewerState => controller?.getState() ?? initialState,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as const;
}
