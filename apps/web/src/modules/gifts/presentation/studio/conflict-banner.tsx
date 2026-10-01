"use client";

import { Button } from "@love-memory/ui";
import { useState } from "react";
import { useStore } from "zustand";

import { useStudio } from "./studio-context";

/** The explicit revision conflict choice; nothing is resolved without one of the two actions. */
export function ConflictBanner() {
  const { controller, store } = useStudio();
  const conflict = useStore(store, (state) => state.conflict);
  const reloadError = useStore(store, (state) => state.reloadError);
  const [isBusy, setIsBusy] = useState(false);

  if (!conflict) return null;

  async function run(action: () => Promise<void>) {
    setIsBusy(true);
    try {
      await action();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4" role="alert">
      <p className="text-sm font-bold text-amber-900">
        Bản nháp đã được lưu ở nơi khác (phiên bản {conflict.actualRevision}).
      </p>
      {reloadError ? (
        <p className="mt-2 text-sm font-semibold text-rose-700">
          Chưa tải được bản mới nhất — thử lại.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-3">
        <Button
          disabled={isBusy}
          onClick={() => void run(() => controller.reloadLatest())}
          size="sm"
        >
          Tải bản mới nhất
        </Button>
        <Button
          disabled={isBusy}
          onClick={() => void run(() => controller.keepMine())}
          size="sm"
          variant="outline"
        >
          Giữ bản của tôi
        </Button>
      </div>
    </div>
  );
}

/** Shown once a save found the draft gone or no longer editable. */
export function ReadOnlyAlert() {
  const { store } = useStudio();
  const readOnly = useStore(store, (state) => state.readOnly);

  return readOnly ? (
    <p
      className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800"
      role="alert"
    >
      Bản nháp này không còn chỉnh sửa được. Hãy tải lại trang.
    </p>
  ) : null;
}
