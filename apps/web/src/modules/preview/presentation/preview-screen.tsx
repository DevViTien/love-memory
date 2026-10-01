"use client";

import { Button, cn } from "@love-memory/ui";
import { type Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  type ViewerFallbackReason,
  type ViewerIssue,
  type ViewerLifecycleEvent,
  type ViewerPayload,
  type ViewerSource,
} from "@/modules/viewer/application/viewer-payload";
import { GiftViewer } from "@/modules/viewer/presentation/gift-viewer";

import { IssuesPanel } from "./issues-panel";
import { mergePreviewIssues } from "./preview-issues";
import { chooseRestartMode, type PreviewRestartAction } from "./preview-restart";

export type PreviewScreenProps = Readonly<{
  canEdit: boolean;
  publicId: string;
  viewer: ViewerPayload;
}>;

type Viewport = "desktop" | "phone";

/**
 * A restart in progress: from the press until the gift viewer of `generation` reports how its
 * runtime settled. `generation` is `null` while the server re-read is still running.
 */
type PendingRestart = Readonly<{ action: PreviewRestartAction; generation: number | null }>;

const FRAME_CLASSES: Readonly<Record<Viewport, string>> = {
  desktop: "aspect-[16/10] w-full",
  phone: "mx-auto aspect-[9/16] w-full max-w-sm",
};

const TEMPLATE_FAILURES: readonly ViewerFallbackReason[] = [
  "ERROR",
  "INIT_TIMEOUT",
  "LOAD_TIMEOUT",
];

const RELOADING_TEXT = "Đang tải lại bản xem trước…";

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-4 shrink-0 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin"
    />
  );
}

/** Both labels share one grid cell, so switching to the busy label never changes the width. */
function ControlLabel({
  busy,
  busyLabel,
  label,
}: Readonly<{ busy: boolean; busyLabel: string; label: string }>) {
  return (
    <span className="grid">
      <span
        aria-hidden={busy ? true : undefined}
        className={cn("col-start-1 row-start-1", busy && "invisible")}
      >
        {label}
      </span>
      <span
        aria-hidden={busy ? undefined : true}
        className={cn(
          "col-start-1 row-start-1 inline-flex items-center justify-center gap-2",
          !busy && "invisible",
        )}
      >
        {/* The spinner exists only while busy: an idle, hidden animation would still run. */}
        {busy ? <Spinner /> : <span aria-hidden="true" className="inline-block size-4 shrink-0" />}
        {busyLabel}
      </span>
    </span>
  );
}

/**
 * The preview page: the shared gift viewer with a ready source, viewport, restart, mute and
 * reduced-motion controls, and the issues panel. Opening a preview is not opening a gift, so no
 * lifecycle notification is reported anywhere.
 *
 * A restart remounts the gift viewer. While the held signed asset URLs stay valid it replays the
 * held payload in the browser; otherwise it re-reads the draft inside a transition first. Either
 * way the pressed control and the frame show pending feedback until the new runtime settled.
 */
export function PreviewScreen({ canEdit, publicId, viewer }: PreviewScreenProps) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [viewport, setViewport] = useState<Viewport>("phone");
  const [muted, setMuted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [appliedReducedMotion, setAppliedReducedMotion] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [pending, setPending] = useState<PendingRestart | null>(null);
  /** A server re-read is running for a restart with this reduced-motion setting. */
  const [awaitedPayload, setAwaitedPayload] = useState<Readonly<{ reducedMotion: boolean }> | null>(
    null,
  );
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [templateIssues, setTemplateIssues] = useState<readonly ViewerIssue[]>([]);
  const [fallbackReason, setFallbackReason] = useState<ViewerFallbackReason | null>(null);
  const [renderedViewer, setRenderedViewer] = useState(viewer);
  const [wasRefreshing, setWasRefreshing] = useState(false);

  function remount(nextReducedMotion: boolean, action: PreviewRestartAction) {
    const next = generation + 1;
    setAppliedReducedMotion(nextReducedMotion);
    setGeneration(next);
    setPending({ action, generation: next });
    setTemplateIssues([]);
    setFallbackReason(null);
  }

  // A server restart remounts the gift viewer only once the refreshed payload (re-read draft, fresh
  // signed URLs) has arrived. A refresh for expired asset URLs keeps the gift running. When the
  // re-read's transition ends without a new payload, the running gift stays and the creator can
  // retry.
  if (viewer !== renderedViewer || isRefreshing !== wasRefreshing) {
    const arrived = viewer !== renderedViewer;
    const refreshEnded = wasRefreshing && !isRefreshing;
    setRenderedViewer(viewer);
    setWasRefreshing(isRefreshing);
    if (awaitedPayload && pending && arrived) {
      setAwaitedPayload(null);
      remount(awaitedPayload.reducedMotion, pending.action);
    } else if (awaitedPayload && refreshEnded) {
      setAwaitedPayload(null);
      setPending(null);
      setReducedMotion(appliedReducedMotion);
      setRefreshFailed(true);
    }
  }

  const source = useMemo<ViewerSource>(() => ({ kind: "ready", viewer }), [viewer]);
  const items = useMemo(
    () =>
      mergePreviewIssues(viewer.fields, viewer.issues ?? [], templateIssues, { canEdit, publicId }),
    [canEdit, publicId, templateIssues, viewer],
  );

  function restart(nextReducedMotion: boolean, action: PreviewRestartAction) {
    if (pending) return;
    setRefreshFailed(false);
    if (chooseRestartMode(viewer, Date.now()) === "client") {
      remount(nextReducedMotion, action);
      return;
    }
    setPending({ action, generation: null });
    setAwaitedPayload({ reducedMotion: nextReducedMotion });
    startRefresh(() => router.refresh());
  }

  function onRuntimeSettled(settledGeneration: number) {
    // Only the gift viewer this restart mounted ends it, never the one it replaces.
    setPending((current) => (current?.generation === settledGeneration ? null : current));
  }

  function onLifecycleEvent(event: ViewerLifecycleEvent) {
    // Local display only: a preview never produces recipient events.
    if (event.type === "fallback") setFallbackReason(event.reason);
  }

  const restarting = pending?.action === "restart";
  const applyingMotion = pending?.action === "reduced-motion";
  const templateFailed = fallbackReason !== null && TEMPLATE_FAILURES.includes(fallbackReason);

  return (
    <div className="space-y-6">
      <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
        Liên kết xem trước riêng tư, hết hạn sau 30 phút. Đừng chia sẻ liên kết này.
      </p>
      {viewer.artifactUrl === null ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Phiên bản mẫu của bản nháp này không hỗ trợ xem trước hiệu ứng.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div aria-label="Khung xem" className="flex gap-2" role="group">
          <Button
            aria-pressed={viewport === "phone"}
            onClick={() => setViewport("phone")}
            variant={viewport === "phone" ? "primary" : "outline"}
          >
            Điện thoại
          </Button>
          <Button
            aria-pressed={viewport === "desktop"}
            onClick={() => setViewport("desktop")}
            variant={viewport === "desktop" ? "primary" : "outline"}
          >
            Máy tính
          </Button>
        </div>
        <Button
          aria-busy={restarting ? true : undefined}
          aria-disabled={restarting ? true : undefined}
          className="aria-disabled:cursor-progress"
          disabled={applyingMotion}
          onClick={() => restart(reducedMotion, "restart")}
          variant="outline"
        >
          <ControlLabel busy={restarting} busyLabel="Đang phát lại…" label="Phát lại" />
        </Button>
        <Button
          aria-busy={applyingMotion ? true : undefined}
          aria-disabled={applyingMotion ? true : undefined}
          aria-pressed={reducedMotion}
          className="aria-disabled:cursor-progress"
          disabled={restarting}
          onClick={() => {
            if (pending) return;
            const next = !reducedMotion;
            setReducedMotion(next);
            restart(next, "reduced-motion");
          }}
          variant="outline"
        >
          <ControlLabel busy={applyingMotion} busyLabel="Đang áp dụng…" label="Giảm chuyển động" />
        </Button>
        {canEdit ? (
          <Link
            className="ml-auto text-sm font-bold text-rose-700 underline"
            href={`/studio/${encodeURIComponent(publicId)}?step=preview` as Route}
          >
            Quay lại chỉnh sửa
          </Link>
        ) : null}
      </div>

      <div>
        <div className={FRAME_CLASSES[viewport]} data-viewport={viewport}>
          <div className="relative h-full w-full overflow-hidden rounded-3xl border border-rose-200 shadow-lg">
            <div className="h-full w-full" inert={pending !== null}>
              <GiftViewer
                forceReducedMotion={appliedReducedMotion}
                key={generation}
                muted={muted}
                onAssetsExpired={() => router.refresh()}
                onIssuesChange={setTemplateIssues}
                onLifecycleEvent={onLifecycleEvent}
                onMutedChange={setMuted}
                onRuntimeSettled={() => onRuntimeSettled(generation)}
                source={source}
              />
            </div>
            {/* Only while pending: an idle layer over the template frame could take its input. */}
            {pending ? (
              <div
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center bg-stone-950/60 px-6"
                data-preview-loading=""
              >
                <span className="inline-flex items-center gap-3 rounded-full bg-white px-5 py-3 text-sm font-semibold text-stone-800 shadow-lg">
                  <Spinner />
                  {RELOADING_TEXT}
                </span>
              </div>
            ) : null}
          </div>
        </div>
        {/* Always present, so the polite status is announced when its text appears. */}
        <p aria-live="polite" className="sr-only" role="status">
          {pending ? RELOADING_TEXT : ""}
        </p>
        {refreshFailed ? (
          <p
            className="mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900"
            role="alert"
          >
            Chưa tải lại được bản xem trước. Hãy thử lại.
          </p>
        ) : null}
        {templateFailed ? (
          <p
            className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
            role="status"
          >
            Đang hiển thị bản tĩnh vì mẫu quà không chạy được. Người nhận vẫn thấy đầy đủ nội dung.
          </p>
        ) : null}
      </div>

      <IssuesPanel canEdit={canEdit} items={items} templateFailed={templateFailed} />
    </div>
  );
}
