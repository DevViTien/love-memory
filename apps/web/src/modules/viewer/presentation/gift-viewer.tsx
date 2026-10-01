"use client";

import { Button } from "@love-memory/ui";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  type ViewerIssue,
  type ViewerLifecycleEvent,
  type ViewerSource,
} from "../application/viewer-payload";
import {
  createElementAudio,
  createGiftViewerController,
  createGiftViewerHost,
  createWindowTemplateBridge,
  type GiftViewerPhase,
  type GiftViewerRuntime,
  type GiftViewerRuntimeOutcome,
  initialGiftViewerState,
} from "./gift-viewer-controller";
import { toStaticGiftBlocks } from "./static-gift-content";
import { StaticGiftContent } from "./static-gift-content-view";

export type GiftViewerProps = Readonly<{
  forceReducedMotion?: boolean;
  muted?: boolean;
  /** A ready source only: the host page should pass a payload with fresh asset URLs. */
  onAssetsExpired?: () => void;
  onIssuesChange?: (issues: readonly ViewerIssue[]) => void;
  onLifecycleEvent?: (event: ViewerLifecycleEvent) => void;
  onMutedChange?: (muted: boolean) => void;
  /** Once per mount: the template answered `READY`, or the static rendering took over. */
  onRuntimeSettled?: (outcome: GiftViewerRuntimeOutcome) => void;
  source: ViewerSource;
}>;

const OPENED_PHASES: readonly GiftViewerPhase[] = ["playing", "paused", "complete"];

/**
 * Presents a gift to a person: the envelope and its `Mở quà` gesture, the sandboxed template, audio
 * and mute, pause on hidden pages, and a static rendering that keeps every text and photo readable
 * when the template cannot run. All decisions live in `gift-viewer-controller.ts`.
 */
export function GiftViewer(props: GiftViewerProps) {
  const propsRef = useRef(props);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const staticHeadingRef = useRef<HTMLHeadingElement>(null);
  const openingStatusRef = useRef<HTMLDivElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const previousPhase = useRef<GiftViewerPhase>("envelope");
  const previousRuntime = useRef<GiftViewerRuntime>("idle");
  const [host] = useState(() =>
    createGiftViewerHost(initialGiftViewerState(props.source, props.muted ?? false)),
  );
  const state = useSyncExternalStore(host.subscribe, host.getState, host.getState);

  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement) return;
    const initial = propsRef.current;
    audioElement.muted = initial.muted ?? false;
    const controller = createGiftViewerController({
      audio: createElementAudio(audioElement),
      createBridge: createWindowTemplateBridge(window),
      forceReducedMotion: initial.forceReducedMotion ?? false,
      muted: initial.muted ?? false,
      onAssetsExpired: () => propsRef.current.onAssetsExpired?.(),
      onIssuesChange: (issues) => propsRef.current.onIssuesChange?.(issues),
      onLifecycleEvent: (event) => propsRef.current.onLifecycleEvent?.(event),
      onMutedChange: (muted) => propsRef.current.onMutedChange?.(muted),
      onRuntimeSettled: (outcome) => propsRef.current.onRuntimeSettled?.(outcome),
      source: initial.source,
      systemPrefersReducedMotion: () =>
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    });
    host.connect(controller);
    const onVisibility = () => controller.setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      host.disconnect();
    };
  }, [host]);

  // The artifact URL is set only on the client; the iframe is then created with it (see below).
  useEffect(() => {
    host.current()?.mounted();
  }, [host, state.frameVisible]);

  const { source } = props;
  useEffect(() => {
    if (source.kind === "ready") host.current()?.updateViewer(source.viewer);
  }, [host, source]);

  useEffect(() => {
    const opened = OPENED_PHASES.includes(state.phase);
    const fellBack = state.runtime === "fallback" && previousRuntime.current !== "fallback";
    if (opened && !OPENED_PHASES.includes(previousPhase.current)) {
      if (state.runtime === "fallback") staticHeadingRef.current?.focus();
      else iframeRef.current?.focus();
    } else if (opened && fellBack) {
      // The iframe that had focus is gone: the static content takes over, so focus follows it.
      staticHeadingRef.current?.focus();
    }
    // Focus never falls back to the document body when the control that held it disappears.
    if (state.phase !== previousPhase.current) {
      if (state.phase === "opening" || state.phase === "loading-content") {
        openingStatusRef.current?.focus();
      } else if (state.phase === "paused") {
        resumeRef.current?.focus();
      } else if (state.phase === "load-failed") {
        retryRef.current?.focus();
      }
    }
    previousPhase.current = state.phase;
    previousRuntime.current = state.runtime;
  }, [state.phase, state.runtime]);

  const blocks = useMemo(
    () =>
      state.viewer
        ? toStaticGiftBlocks(state.viewer.fields, state.viewer.payload, state.viewer.assets)
        : [],
    [state.viewer],
  );

  const opened = OPENED_PHASES.includes(state.phase);
  const envelopeShown = state.phase === "envelope";
  const showStatic = state.runtime === "fallback" && opened;
  const hasAudio = Boolean(state.viewer?.audioUrl);
  const controller = () => host.current();

  return (
    <div className="relative h-full w-full overflow-hidden bg-stone-950">
      {/* Created only with its URL: React attaches `onLoad` before inserting the element, so no
          load is missed and the initial `about:blank` document never fires one. */}
      {state.frameVisible && state.viewer?.artifactUrl && state.frameSrc ? (
        <iframe
          aria-hidden={envelopeShown ? true : undefined}
          className="absolute inset-0 h-full w-full border-0"
          onLoad={() => {
            const frame = iframeRef.current;
            controller()?.attach(frame?.contentWindow ?? null, frame?.getAttribute("src") ?? null);
          }}
          ref={iframeRef}
          sandbox="allow-scripts"
          src={state.frameSrc}
          tabIndex={envelopeShown ? -1 : undefined}
          title="LoveMemory template viewer"
        />
      ) : null}

      {showStatic ? (
        <div className="absolute inset-0">
          <StaticGiftContent
            blocks={blocks}
            failedImages={state.failedImages}
            onImageError={(assetId) => controller()?.imageFailed(assetId)}
            ref={staticHeadingRef}
          />
        </div>
      ) : null}

      {envelopeShown ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-rose-100 to-amber-50 px-6 text-center">
          <h2 className="text-2xl font-black text-stone-900">Bạn có một món quà</h2>
          <Button className="min-w-44" onClick={() => controller()?.open()} size="lg">
            Mở quà
          </Button>
        </div>
      ) : null}

      {state.phase === "opening" || state.phase === "loading-content" ? (
        <div
          aria-live="polite"
          className="absolute inset-0 flex items-center justify-center bg-rose-50/90 px-6 text-center font-semibold text-stone-800 focus:outline-none"
          ref={openingStatusRef}
          role="status"
          tabIndex={-1}
        >
          Đang mở quà…
        </div>
      ) : null}

      {state.phase === "load-failed" ? (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-rose-50 px-6 text-center"
          role="alert"
        >
          <p className="font-semibold text-stone-800">
            Chưa mở được món quà. Hãy kiểm tra kết nối và thử lại.
          </p>
          <Button onClick={() => controller()?.retry()} ref={retryRef} size="lg">
            Thử lại
          </Button>
        </div>
      ) : null}

      {state.phase === "paused" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-stone-950/60 px-6">
          <Button onClick={() => controller()?.resume()} ref={resumeRef} size="lg">
            Tiếp tục
          </Button>
        </div>
      ) : null}

      {opened && hasAudio ? (
        <div className="absolute top-3 right-3 flex flex-col items-end gap-2">
          <Button
            aria-pressed={state.muted}
            className="h-11 min-w-11"
            onClick={() => controller()?.toggleMute()}
            variant="outline"
          >
            {state.muted ? "Bật tiếng" : "Tắt tiếng"}
          </Button>
        </div>
      ) : null}

      {state.audioNotice && !envelopeShown ? (
        <p
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-4 py-2 text-sm text-stone-800"
          role="status"
        >
          Không phát được nhạc.
        </p>
      ) : null}

      <audio preload="none" ref={audioRef} />
    </div>
  );
}
