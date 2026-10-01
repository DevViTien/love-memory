import type { TemplateEvent } from "@love-memory/template-sdk";

import { createErrorBoundary } from "./fallback";
import type { PhotoLoader } from "./images";
import {
  type ContentIssue,
  issueKey,
  type MemoryBoxContent,
  type MemoryItem,
  normalizeInit,
} from "./payload";
import { type InitMessage, readHostMessage, stableStringify } from "./protocol";
import type { MemoryBoxView } from "./render";
import { buildScenes, type Scene } from "./scenes";

export type ControllerState =
  "complete" | "cover" | "destroyed" | "failed" | "loading" | "paused" | "playing";

export type ControllerDependencies = Readonly<{
  clearTimer: (id: number) => void;
  createPhotoLoader: (
    options: Readonly<{
      guard: (callback: () => void) => () => void;
      memories: readonly MemoryItem[];
      onError: (index: number) => void;
    }>,
  ) => PhotoLoader;
  createView: (onNext: () => void) => MemoryBoxView;
  now: () => number;
  /** Called once on `DESTROY`, so the caller stops listening for messages. */
  onDestroy: () => void;
  post: (event: TemplateEvent) => void;
  setTimer: (callback: () => void, delayMs: number) => number;
}>;

export type MemoryBoxController = Readonly<{
  /** Runtime failure path: static fallback, one `ERROR RUNTIME_ERROR`, no more scene events. */
  fail: (error?: unknown) => void;
  /** Handles one message from the parent window. Never throws. */
  receive: (data: unknown) => void;
  state: () => ControllerState;
}>;

type Session = {
  readonly content: MemoryBoxContent;
  readonly key: string;
  loader?: PhotoLoader;
  readonly reducedMotion: boolean;
  readonly reported: Set<string>;
  sceneIndex: number;
  readonly scenes: readonly Scene[];
};

type RunningTimer = Readonly<{ delayMs: number; id: number; startedAt: number }>;

/**
 * The Memory Box state machine: `loading → cover → playing ⇄ paused → complete`, plus `failed` and
 * `destroyed`. All effects (DOM, timers, messages, images) are injected.
 */
export function createMemoryBoxController(
  dependencies: ControllerDependencies,
): MemoryBoxController {
  const { post } = dependencies;
  let state: ControllerState = "loading";
  let session: Session | undefined;
  let pendingPlay = false;
  let timer: RunningTimer | undefined;
  let pausedRemainingMs: number | undefined;

  const { guard } = createErrorBoundary(fail);
  const view = dependencies.createView(guard(next));
  view.setMotion(false);
  view.setState("loading");
  view.renderLoading();

  function setState(next: ControllerState) {
    state = next;
    view.setState(next);
  }

  function clearTimer() {
    if (timer) dependencies.clearTimer(timer.id);
    timer = undefined;
  }

  function schedule(delayMs: number) {
    clearTimer();
    timer = {
      delayMs,
      id: dependencies.setTimer(guard(onTimer), delayMs),
      startedAt: dependencies.now(),
    };
  }

  function currentScene(): Scene | undefined {
    return session?.scenes[session.sceneIndex];
  }

  function report(issue: ContentIssue) {
    if (!session) return;
    const key = issueKey(issue);
    if (session.reported.has(key)) return;
    session.reported.add(key);
    post({
      code: issue.code,
      fieldId: issue.fieldId,
      ...(issue.itemIndex === undefined ? {} : { itemIndex: issue.itemIndex }),
      protocolVersion: 1,
      type: "ISSUE",
    });
  }

  function renderCurrentScene() {
    const scene = currentScene();
    if (!session || !scene) return;
    const image =
      scene.memoryIndex === undefined ? undefined : session.loader?.take(scene.memoryIndex);
    view.renderScene(scene, session.content, {
      ...(image ? { image } : {}),
      memoryCount: session.content.memories.length,
      paused: state === "paused",
      reducedMotion: session.reducedMotion,
    });
  }

  function onPhotoError(index: number) {
    report({ code: "ASSET_UNAVAILABLE", fieldId: "memories", itemIndex: index });
    if ((state === "playing" || state === "paused") && currentScene()?.memoryIndex === index) {
      renderCurrentScene();
    }
  }

  function endSession() {
    clearTimer();
    pausedRemainingMs = undefined;
    session?.loader?.stop();
  }

  function initialize(message: InitMessage) {
    const key = stableStringify({
      assets: message.assets,
      context: message.context,
      payload: message.payload,
    });
    if (session?.key === key && state !== "failed") {
      post({ protocolVersion: 1, type: "READY" });
      return;
    }

    endSession();
    const reducedMotion = message.context.prefersReducedMotion;
    const { content, issues } = normalizeInit(message.payload, message.assets);
    const current: Session = {
      content,
      key,
      reducedMotion,
      reported: new Set(),
      sceneIndex: -1,
      scenes: buildScenes(content, reducedMotion),
    };
    session = current;
    setState("cover");
    view.setPaused(false);
    view.setMotion(reducedMotion);
    view.setTheme(content.theme);
    view.renderCover(content);
    post({ protocolVersion: 1, type: "READY" });
    for (const issue of issues) report(issue);

    current.loader = dependencies.createPhotoLoader({
      guard,
      memories: content.memories,
      onError: (index) => {
        if (session === current) onPhotoError(index);
      },
    });
    current.loader.start();

    if (pendingPlay) {
      pendingPlay = false;
      play();
    }
  }

  function startScene(index: number) {
    const scene = session?.scenes[index];
    if (!session || !scene) return;
    clearTimer();
    pausedRemainingMs = undefined;
    session.sceneIndex = index;
    setState("playing");
    renderCurrentScene();
    post({ sceneId: scene.id, type: "SCENE" });

    if (scene.kind === "finale" && scene.delayMs === 0) {
      complete();
    } else if (scene.delayMs !== null) {
      schedule(scene.delayMs);
    }
  }

  function complete() {
    clearTimer();
    setState("complete");
    post({ type: "COMPLETE" });
  }

  function advance() {
    if (!session) return;
    startScene(session.sceneIndex + 1);
  }

  function onTimer() {
    timer = undefined;
    if (state !== "playing") return;
    if (currentScene()?.kind === "finale") complete();
    else advance();
  }

  function next() {
    if (state !== "playing") return;
    if (currentScene()?.kind === "finale") return;
    advance();
  }

  function play() {
    switch (state) {
      case "loading":
        pendingPlay = true;
        return;
      case "cover":
        view.setPaused(false);
        startScene(0);
        return;
      case "complete":
        // The sequence is over; only unfreeze the settling finale animations.
        view.setPaused(false);
        return;
      case "paused":
        setState("playing");
        view.setPaused(false);
        if (pausedRemainingMs !== undefined) schedule(pausedRemainingMs);
        pausedRemainingMs = undefined;
        return;
      default:
        return;
    }
  }

  function pause() {
    if (state === "loading") {
      pendingPlay = false;
      return;
    }
    if (state === "cover" || state === "complete") {
      // No timer runs here, but the cover's breathing and the finale's particles still animate.
      view.setPaused(true);
      return;
    }
    if (state !== "playing") return;
    pausedRemainingMs = timer
      ? Math.max(0, timer.delayMs - (dependencies.now() - timer.startedAt))
      : undefined;
    clearTimer();
    setState("paused");
    view.setPaused(true);
  }

  function destroy() {
    endSession();
    session = undefined;
    pendingPlay = false;
    view.clear();
    setState("destroyed");
    dependencies.onDestroy();
  }

  function fail() {
    if (state === "failed" || state === "destroyed") return;
    state = "failed";
    pendingPlay = false;
    endSession();
    try {
      view.renderFallback(session?.content);
    } catch {
      try {
        view.renderFatal();
      } catch {
        // Nothing else can render; the host's static fallback takes over after ERROR.
      }
    }
    try {
      view.setState("failed");
    } catch {
      // The state attribute only drives styling.
    }
    post({ code: "RUNTIME_ERROR", type: "ERROR" });
  }

  const receive = guard((data: unknown) => {
    if (state === "destroyed") return;
    const result = readHostMessage(data);
    if (result.kind === "ignored") return;
    if (result.kind === "invalid-init") {
      post({ code: "INVALID_MESSAGE", type: "ERROR" });
      return;
    }

    const { message } = result;
    switch (message.type) {
      case "INIT":
        initialize(message);
        return;
      case "PLAY":
        play();
        return;
      case "PAUSE":
        pause();
        return;
      case "DESTROY":
        destroy();
        return;
    }
  });

  return { fail, receive, state: () => state };
}
