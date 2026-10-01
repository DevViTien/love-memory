"use client";

import { type GiftPublicationDto } from "@love-memory/contracts";
import { Button } from "@love-memory/ui";
import { useState, useSyncExternalStore } from "react";

type CopyState = "copied" | "failed" | "idle";

function subscribeToNothing(): () => void {
  return () => undefined;
}

/**
 * The Studio of a published gift: the share link and how to pass it on. The server render shows the
 * share path; the browser adds its own origin after hydration, so the API never needs `APP_URL`.
 */
export function PublishedPanel({ publication }: Readonly<{ publication: GiftPublicationDto }>) {
  const origin = useSyncExternalStore(
    subscribeToNothing,
    () => window.location.origin,
    () => null,
  );
  const shareUrl = origin ? new URL(publication.sharePath, origin).href : publication.sharePath;
  const [copyState, setCopyState] = useState<CopyState>("idle");

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
      {copyState === "failed" ? (
        <p className="text-sm font-semibold text-rose-700" role="alert">
          Không sao chép được — hãy chọn đường dẫn và sao chép thủ công.
        </p>
      ) : null}
      <p className="text-sm leading-6 text-stone-700">
        Ai có đường dẫn này đều mở được món quà. Chỉ chia sẻ với người nhận.
      </p>
      <p className="text-sm leading-6 text-stone-700">Món quà đã xuất bản không thể chỉnh sửa.</p>
    </section>
  );
}
