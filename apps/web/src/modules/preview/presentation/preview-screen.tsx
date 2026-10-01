"use client";

import { Button } from "@love-memory/ui";
import { type Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

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

export type PreviewScreenProps = Readonly<{
  canEdit: boolean;
  publicId: string;
  viewer: ViewerPayload;
}>;

type Viewport = "desktop" | "phone";

const FRAME_CLASSES: Readonly<Record<Viewport, string>> = {
  desktop: "aspect-[16/10] w-full",
  phone: "mx-auto aspect-[9/16] w-full max-w-sm",
};

const TEMPLATE_FAILURES: readonly ViewerFallbackReason[] = [
  "ERROR",
  "INIT_TIMEOUT",
  "LOAD_TIMEOUT",
];

/**
 * The preview page: the shared gift viewer with a ready source, viewport, restart, mute and
 * reduced-motion controls, and the issues panel. Opening a preview is not opening a gift, so no
 * lifecycle notification is reported anywhere.
 */
export function PreviewScreen({ canEdit, publicId, viewer }: PreviewScreenProps) {
  const router = useRouter();
  const [viewport, setViewport] = useState<Viewport>("phone");
  const [muted, setMuted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [appliedReducedMotion, setAppliedReducedMotion] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [pendingRestart, setPendingRestart] = useState<Readonly<{ reducedMotion: boolean }> | null>(
    null,
  );
  const [templateIssues, setTemplateIssues] = useState<readonly ViewerIssue[]>([]);
  const [fallbackReason, setFallbackReason] = useState<ViewerFallbackReason | null>(null);
  const [renderedViewer, setRenderedViewer] = useState(viewer);

  // A restart remounts the gift viewer only once the refreshed payload (re-read draft, fresh
  // signed URLs) has arrived. A refresh for expired asset URLs keeps the gift running.
  if (viewer !== renderedViewer) {
    setRenderedViewer(viewer);
    if (pendingRestart) {
      setPendingRestart(null);
      setAppliedReducedMotion(pendingRestart.reducedMotion);
      setGeneration((value) => value + 1);
      setTemplateIssues([]);
      setFallbackReason(null);
    }
  }

  const source = useMemo<ViewerSource>(() => ({ kind: "ready", viewer }), [viewer]);
  const items = useMemo(
    () =>
      mergePreviewIssues(viewer.fields, viewer.issues ?? [], templateIssues, { canEdit, publicId }),
    [canEdit, publicId, templateIssues, viewer],
  );

  function restart(nextReducedMotion: boolean) {
    setPendingRestart({ reducedMotion: nextReducedMotion });
    router.refresh();
  }

  function onLifecycleEvent(event: ViewerLifecycleEvent) {
    // Local display only: a preview never produces recipient events.
    if (event.type === "fallback") setFallbackReason(event.reason);
  }

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
        <Button onClick={() => restart(reducedMotion)} variant="outline">
          Phát lại
        </Button>
        <Button
          aria-pressed={reducedMotion}
          onClick={() => {
            const next = !reducedMotion;
            setReducedMotion(next);
            restart(next);
          }}
          variant="outline"
        >
          Giảm chuyển động
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

      <div className={FRAME_CLASSES[viewport]} data-viewport={viewport}>
        <div className="h-full w-full overflow-hidden rounded-3xl border border-rose-200 shadow-lg">
          <GiftViewer
            forceReducedMotion={appliedReducedMotion}
            key={generation}
            muted={muted}
            onAssetsExpired={() => router.refresh()}
            onIssuesChange={setTemplateIssues}
            onLifecycleEvent={onLifecycleEvent}
            onMutedChange={setMuted}
            source={source}
          />
        </div>
      </div>

      <IssuesPanel
        canEdit={canEdit}
        items={items}
        templateFailed={fallbackReason !== null && TEMPLATE_FAILURES.includes(fallbackReason)}
      />
    </div>
  );
}
