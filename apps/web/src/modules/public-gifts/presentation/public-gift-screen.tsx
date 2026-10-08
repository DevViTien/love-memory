"use client";

import { type AnalyticsContext } from "@love-memory/contracts";
import { useMemo, useState } from "react";

import { createAnalyticsClient } from "@/modules/analytics/presentation/analytics-client";
import { createRecipientEventReporter } from "@/modules/analytics/presentation/recipient-events";

import { type ViewerSource } from "@/modules/viewer/application/viewer-payload";
import { GiftViewer } from "@/modules/viewer/presentation/gift-viewer";

import { loadPublicGift } from "./load-public-gift";

type PublicGiftScreenProps = Readonly<{
  /** The funnel analytics context from the page; `null` (analytics disabled) sends nothing. */
  analytics?: AnalyticsContext | null;
  shareId: string;
  /** The Free plan's host-level mark (`gift-plans`); never sent to the template. */
  watermark?: boolean;
}>;

/**
 * The recipient's gift: the shared gift viewer with a deferred source. Nothing about the gift is
 * in the page until the `Mở quà` gesture loads it. The viewer's lifecycle notifications become
 * recipient funnel events here, and only here: the preview and the harness never report.
 */
export function PublicGiftScreen({
  analytics = null,
  shareId,
  watermark = false,
}: PublicGiftScreenProps) {
  const [muted, setMuted] = useState(false);
  // Keyed on the values, not the prop object: an equal context never resets the reporter.
  const giftRef = analytics?.giftRef;
  const templateId = analytics?.templateId;
  const templateVersion = analytics?.templateVersion;
  const onLifecycleEvent = useMemo(
    () =>
      createRecipientEventReporter(
        createAnalyticsClient({
          context:
            giftRef && templateId && templateVersion
              ? { giftRef, templateId, templateVersion }
              : null,
        }),
      ),
    [giftRef, templateId, templateVersion],
  );
  const source = useMemo<ViewerSource>(
    () => ({ kind: "deferred", load: () => loadPublicGift(fetch, shareId) }),
    [shareId],
  );

  return (
    <div
      className="relative mx-auto aspect-[9/16] max-h-[85vh] w-full max-w-md overflow-hidden rounded-[2rem] border border-rose-100 bg-white shadow-lg shadow-rose-100/50 sm:aspect-[3/4]"
      data-public-gift=""
    >
      <GiftViewer
        muted={muted}
        onLifecycleEvent={onLifecycleEvent}
        onMutedChange={setMuted}
        source={source}
      />
      {watermark ? (
        // Host chrome over the frame, outside the template's iframe; taps pass through to the gift.
        <p
          className="pointer-events-none absolute right-3 bottom-2 z-10 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-stone-700 shadow-sm select-none"
          data-gift-watermark=""
        >
          Tạo bằng LoveMemory
        </p>
      ) : null}
    </div>
  );
}
