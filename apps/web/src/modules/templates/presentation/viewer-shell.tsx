"use client";

import {
  createMediaElementAudioController,
  createTemplateBridge,
  readTrustedTemplateEvent,
  type TemplateEvent,
} from "@love-memory/template-sdk";
import { Button } from "@love-memory/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Props = Readonly<{
  artifactUrl: string;
  assetUrls?: Readonly<Record<string, string>>;
  audioUrl?: string;
  payload: Parameters<ReturnType<typeof createTemplateBridge>["initialize"]>[0];
}>;

const EMPTY_ASSET_URLS: Readonly<Record<string, string>> = {};

type IssueScope = Readonly<{
  assets: Readonly<Record<string, string>>;
  payload: Props["payload"];
  reducedMotion: boolean;
}>;

function issueKey(event: Extract<TemplateEvent, { type: "ISSUE" }>): string {
  return `${event.code}|${event.fieldId}|${event.itemIndex ?? ""}`;
}

export function ViewerShell({ artifactUrl, assetUrls, audioUrl, payload }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const bridgeRef = useRef<ReturnType<typeof createTemplateBridge> | null>(null);
  const handshakeTimerRef = useRef<number | null>(null);
  const startedAt = useRef(0);
  const playStartedAt = useRef<number | null>(null);
  const issueScopeRef = useRef<IssueScope | null>(null);
  const issueKeysRef = useRef(new Set<string>());
  const [events, setEvents] = useState<readonly TemplateEvent[]>([]);
  const [status, setStatus] = useState("Đang tải artifact…");
  const [viewport, setViewport] = useState<"mobile" | "desktop">("desktop");
  const [forceReducedMotion, setForceReducedMotion] = useState(false);
  const [issueCount, setIssueCount] = useState(0);
  const [performanceCounters, setPerformanceCounters] = useState<{
    completeMs?: number;
    readyMs?: number;
  }>({});
  const resolvedAssetUrls = useMemo(() => assetUrls ?? EMPTY_ASSET_URLS, [assetUrls]);

  useEffect(() => {
    startedAt.current = performance.now();
  }, []);

  const stopHandshake = useCallback(() => {
    if (handshakeTimerRef.current !== null) {
      window.clearInterval(handshakeTimerRef.current);
      handshakeTimerRef.current = null;
    }
  }, []);

  /**
   * Distinct issues are counted per payload and context. Handshake retries and iframe `load`
   * resend the same INIT, so they keep the count.
   */
  const scopeIssues = useCallback((scope: IssueScope) => {
    const current = issueScopeRef.current;
    if (
      current?.payload === scope.payload &&
      current.assets === scope.assets &&
      current.reducedMotion === scope.reducedMotion
    ) {
      return;
    }
    issueScopeRef.current = scope;
    issueKeysRef.current = new Set();
    setIssueCount(0);
  }, []);

  const connect = useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    stopHandshake();
    scopeIssues({ assets: resolvedAssetUrls, payload, reducedMotion: forceReducedMotion });
    bridgeRef.current?.disconnect();
    const bridge = createTemplateBridge({
      onEvent: (event) => {
        if (event.type === "READY") {
          stopHandshake();
          setPerformanceCounters((current) => ({
            ...current,
            readyMs: Math.round(performance.now() - startedAt.current),
          }));
        }
        if (event.type === "COMPLETE") {
          const baseline = playStartedAt.current ?? startedAt.current;
          setPerformanceCounters((current) => ({
            ...current,
            completeMs: Math.round(performance.now() - baseline),
          }));
        }
        setEvents((current) => [...current.slice(-19), event]);
        if (event.type === "ISSUE") {
          issueKeysRef.current.add(issueKey(event));
          setIssueCount(issueKeysRef.current.size);
          return;
        }
        setStatus(event.type === "ERROR" ? `Runtime error: ${event.code}` : event.type);
      },
      postMessage: (message) => target.postMessage(message, "*"),
      subscribe: (listener) => {
        const onMessage = (event: MessageEvent<unknown>) => {
          const trusted = readTrustedTemplateEvent(event, target);
          if (trusted) listener(trusted);
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
      },
    });
    bridge.start();
    bridge.initialize(
      payload,
      forceReducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      resolvedAssetUrls,
    );
    bridgeRef.current = bridge;
    setStatus(`INIT · ${Math.round(performance.now() - startedAt.current)} ms`);
    let attempts = 1;
    handshakeTimerRef.current = window.setInterval(() => {
      if (attempts >= 20) {
        stopHandshake();
        setStatus("INIT timeout");
        return;
      }
      attempts += 1;
      bridge.initialize(
        payload,
        forceReducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        resolvedAssetUrls,
      );
    }, 250);
  }, [forceReducedMotion, payload, resolvedAssetUrls, scopeIssues, stopHandshake]);

  useEffect(() => {
    const timer = window.setTimeout(connect, 0);
    return () => window.clearTimeout(timer);
  }, [connect]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        bridgeRef.current?.pause();
        audioRef.current?.pause();
        setStatus("PAUSE · tab ẩn");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopHandshake();
      bridgeRef.current?.destroy();
      bridgeRef.current = null;
    };
  }, [stopHandshake]);

  async function play() {
    playStartedAt.current = performance.now();
    setPerformanceCounters((current) =>
      current.readyMs === undefined ? {} : { readyMs: current.readyMs },
    );
    bridgeRef.current?.play();
    if (audioRef.current && audioUrl) {
      const result = await createMediaElementAudioController(audioRef.current).play();
      if (result !== "playing") setStatus(`PLAY · audio ${result}`);
    }
  }

  function destroy() {
    stopHandshake();
    bridgeRef.current?.destroy();
    if (audioRef.current) createMediaElementAudioController(audioRef.current).destroy();
    setStatus("DESTROY");
  }

  function toggleReducedMotion() {
    const next = !forceReducedMotion;
    setForceReducedMotion(next);
    scopeIssues({ assets: resolvedAssetUrls, payload, reducedMotion: next });
    bridgeRef.current?.initialize(payload, next, resolvedAssetUrls);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void play()}>Phát</Button>
        <Button onClick={() => bridgeRef.current?.pause()} variant="outline">
          Tạm dừng
        </Button>
        <Button onClick={destroy} variant="outline">
          Hủy runtime
        </Button>
        <Button
          onClick={() => setViewport((value) => (value === "desktop" ? "mobile" : "desktop"))}
          variant="outline"
        >
          Viewport: {viewport}
        </Button>
        <Button onClick={toggleReducedMotion} variant="outline">
          Reduced motion: {forceReducedMotion ? "bật" : "tắt"}
        </Button>
      </div>
      <div className={viewport === "mobile" ? "mx-auto max-w-sm" : "w-full"}>
        <iframe
          className={`${viewport === "mobile" ? "aspect-[9/16]" : "aspect-[4/3]"} w-full rounded-3xl border border-rose-200 bg-stone-950`}
          onLoad={connect}
          ref={iframeRef}
          sandbox="allow-scripts"
          src={artifactUrl}
          title="LoveMemory template viewer"
        />
      </div>
      {audioUrl ? <audio preload="none" ref={audioRef} src={audioUrl} /> : null}
      <div className="grid gap-4 rounded-2xl bg-stone-900 p-4 text-xs text-stone-200 sm:grid-cols-2">
        <p>
          <strong>Trạng thái:</strong> {status}
        </p>
        <p>
          <strong>Sự kiện hợp lệ:</strong> {events.length}
        </p>
        <p>
          <strong>Vấn đề nội dung:</strong> {issueCount}
        </p>
        <p>
          <strong>READY:</strong> {performanceCounters.readyMs ?? "—"} ms
        </p>
        <p>
          <strong>COMPLETE:</strong> {performanceCounters.completeMs ?? "—"} ms
        </p>
        <ol className="col-span-full max-h-32 overflow-auto font-mono">
          {events.map((event, index) => (
            <li key={`${event.type}-${index}`}>{JSON.stringify(event)}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
