"use client";

import { Button } from "@love-memory/ui";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import { selectStepCompletion } from "./draft-editor-store";
import { navigateToPreview, requestPreview } from "./preview-action";
import { PublishStep } from "./publish-step";
import { stepSearch } from "./studio-steps";
import { studioLinkHandler, useStudio } from "./studio-context";

/**
 * The readiness summary of the `Xem trước` and `Xuất bản` steps. `Xem trước` settles pending saves,
 * then opens a private preview link in this tab; `Xuất bản` publishes (`PublishStep`).
 */
export function ReadinessStep({ kind }: Readonly<{ kind: "preview" | "publish" }>) {
  const { controller, navigation, report, store } = useStudio();
  const completion = useStore(store, selectStepCompletion);
  const incomplete = store
    .getState()
    .context.steps.filter((step) => step.kind === "template" && completion[step.id] === false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    // Back from the preview restores this page from the back/forward cache with the busy state it
    // had while navigating away; the action must work again.
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      busyRef.current = false;
      setBusy(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function openPreview() {
    // A ref, not only state: a second click in the same frame must not send a second request.
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    const outcome = await requestPreview({
      flush: () => controller.flush(),
      publicId: store.getState().context.publicId,
      report,
    });
    switch (outcome.kind) {
      case "open":
        navigateToPreview(outcome.url);
        // Stay busy: the page is navigating away (a back/forward cache restore resets it).
        return;
      case "rate-limited":
        setMessage(
          `Bạn mở xem trước quá nhiều lần. Hãy thử lại sau ${outcome.retryAfterSeconds ?? 60} giây.`,
        );
        break;
      case "gone": {
        // The same non-editable path as a 404 save: the alert shows and autosave stops.
        const state = store.getState();
        state.applyOutcome({ kind: "gone" }, state.content);
        break;
      }
      case "failed":
        setMessage("Chưa mở được bản xem trước — thử lại.");
        break;
      case "blocked":
        break;
    }
    busyRef.current = false;
    setBusy(false);
  }

  return (
    <div className="space-y-5">
      {incomplete.length === 0 ? (
        <p className="text-sm font-semibold text-emerald-700">Tất cả các bước đã sẵn sàng.</p>
      ) : (
        <div>
          <p className="text-sm text-stone-600">Các bước còn thiếu nội dung:</p>
          <ul className="mt-2 space-y-2">
            {incomplete.map((step) => (
              <li
                className="flex items-center justify-between gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-stone-800"
                key={step.id}
              >
                <span>{step.label}</span>
                <a
                  className="font-bold text-rose-700 underline"
                  href={stepSearch(step.id)}
                  onClick={studioLinkHandler(() => navigation.openStep(step.id))}
                >
                  Sửa
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {kind === "preview" ? (
        <div className="space-y-3">
          <Button disabled={busy} onClick={() => void openPreview()} size="lg">
            {busy ? "Đang mở bản xem trước…" : "Xem trước"}
          </Button>
          {message ? (
            <p className="text-sm font-semibold text-rose-700" role="alert">
              {message}
            </p>
          ) : null}
        </div>
      ) : (
        <PublishStep incomplete={incomplete.length > 0} />
      )}
    </div>
  );
}
