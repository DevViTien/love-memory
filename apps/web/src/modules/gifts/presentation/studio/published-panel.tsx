"use client";

import { type GiftPublicationSummary } from "@love-memory/contracts";
import { Button } from "@love-memory/ui";
import { useState, useSyncExternalStore } from "react";

import { formatExpiry } from "./plan-format";
import { useNow } from "./use-now";

type CopyState = "copied" | "failed" | "idle";

function subscribeToNothing(): () => void {
  return () => undefined;
}

export const PUBLISHED_STATUS_MESSAGES = {
  latest: "Người nhận đang xem bản mới nhất.",
  unpublished: "Có thay đổi chưa cập nhật. Người nhận vẫn đang xem bản đã gửi trước đó.",
} as const;

/** The plan line: until when recipients can open the gift, or that it has expired. */
export function publishedPlanLine(planName: string, expiresAt: string, now: number): string {
  const expiry = formatExpiry(expiresAt);
  return Date.parse(expiresAt) <= now
    ? `Món quà đã hết hạn lúc ${expiry}. Người nhận không còn mở được.`
    : `Gói ${planName} · Người nhận mở được đến ${expiry}.`;
}

/**
 * Above the editor of a published gift: the share link, how to pass it on, the plan and its
 * expiry, and whether recipients see the latest saved content. The server render shows the share
 * path; the browser adds its own origin after hydration, so the API never needs `APP_URL`.
 */
export function PublishedPanel({
  hasUnpublishedChanges,
  planName,
  publication,
}: Readonly<{
  hasUnpublishedChanges: boolean;
  planName: string;
  publication: GiftPublicationSummary;
}>) {
  const origin = useSyncExternalStore(
    subscribeToNothing,
    () => window.location.origin,
    () => null,
  );
  const shareUrl = origin ? new URL(publication.sharePath, origin).href : publication.sharePath;
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const now = useNow();

  async function copyLink() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable.");
      await navigator.clipboard.writeText(shareUrl);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section
      aria-labelledby="published-panel-heading"
      className="space-y-5 rounded-3xl border border-emerald-100 bg-emerald-50/60 p-6"
    >
      <h2
        className="text-2xl font-black tracking-tight text-stone-900"
        id="published-panel-heading"
      >
        Đã xuất bản
      </h2>
      <div className="space-y-2">
        <label className="block text-sm font-bold text-stone-700" htmlFor="published-share-url">
          Đường dẫn món quà
        </label>
        <input
          className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-900"
          id="published-share-url"
          onFocus={(event) => event.currentTarget.select()}
          readOnly
          value={shareUrl}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void copyLink()} size="lg">
          {copyState === "copied" ? "Đã sao chép" : "Sao chép liên kết"}
        </Button>
        <a
          className="font-bold text-rose-700 underline"
          href={publication.sharePath}
          rel="noopener noreferrer"
          target="_blank"
        >
          Mở món quà
        </a>
      </div>
      <p className="text-sm font-semibold text-stone-800">
        {publishedPlanLine(planName, publication.expiresAt, now)}
      </p>
      {copyState === "failed" ? (
        <p className="text-sm font-semibold text-rose-700" role="alert">
          Không sao chép được — hãy chọn đường dẫn và sao chép thủ công.
        </p>
      ) : null}
      <p
        className={
          hasUnpublishedChanges
            ? "text-sm font-semibold text-amber-800"
            : "text-sm font-semibold text-emerald-800"
        }
        role="status"
      >
        {hasUnpublishedChanges
          ? PUBLISHED_STATUS_MESSAGES.unpublished
          : PUBLISHED_STATUS_MESSAGES.latest}
      </p>
      <p className="text-sm leading-6 text-stone-700">
        Ai có đường dẫn này đều mở được món quà. Chỉ chia sẻ với người nhận.
      </p>
    </section>
  );
}
