"use client";

import { Button } from "@love-memory/ui";
import { useStore } from "zustand";

import { selectCanSaveNow, selectStatusView } from "./draft-editor-store";
import { studioFieldHref } from "./studio-steps";
import { studioLinkHandler, useStudio } from "./studio-context";

/** The one save status (`role="status"`) and `Lưu ngay`; sticky on small screens. */
export function SaveStatusBar() {
  const { controller, navigation, store } = useStudio();
  const view = useStore(store, selectStatusView);
  const canSaveNow = useStore(store, selectCanSaveNow);
  const generalError = useStore(store, (state) => state.generalError);
  const publicId = store.getState().context.publicId;

  return (
    <div className="sticky bottom-0 z-10 mt-8 border-t border-rose-100 bg-white/95 py-4 backdrop-blur sm:static">
      {generalError ? (
        <p className="mb-3 text-sm font-semibold text-rose-700">{generalError}</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="text-sm font-semibold text-stone-600" role="status">
          {view.kind === "hidden" ? null : view.message}
          {view.kind === "invalid" ? (
            <>
              {" "}
              <a
                className="font-bold text-rose-700 underline"
                href={studioFieldHref(publicId, view.fieldId)}
                onClick={studioLinkHandler(() => navigation.openField(view.fieldId))}
              >
                Sửa
              </a>
            </>
          ) : null}
        </p>
        <Button disabled={!canSaveNow} onClick={() => controller.saveNow()} variant="outline">
          Lưu ngay
        </Button>
      </div>
    </div>
  );
}
