"use client";

import { Button } from "@love-memory/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { type ModerationAction } from "../application/moderation";

const CONFIRMATIONS: Readonly<Record<ModerationAction, string>> = {
  dismiss: "Bỏ qua báo cáo này?",
  restore: "Khôi phục món quà? Người nhận sẽ mở lại được nếu món quà chưa hết hạn.",
  takedown: "Gỡ món quà này? Đường dẫn sẽ không mở được và chủ quà không thể tự mở lại.",
};

const LABELS: Readonly<Record<ModerationAction, string>> = {
  dismiss: "Bỏ qua",
  restore: "Khôi phục",
  takedown: "Gỡ món quà",
};

/** The actions on one report (`abuse-reports`): confirmed, sent, then the page re-renders. */
export function ReportActions({
  actions,
  confirm = (message: string) => window.confirm(message),
  reportId,
}: Readonly<{
  actions: readonly ModerationAction[];
  confirm?: (message: string) => boolean;
  reportId: string;
}>) {
  const router = useRouter();
  const [pending, setPending] = useState<ModerationAction | null>(null);
  const [failed, setFailed] = useState(false);

  async function run(action: ModerationAction) {
    if (!confirm(CONFIRMATIONS[action])) return;
    setPending(action);
    setFailed(false);
    try {
      const response = await fetch(`/api/admin/reports/${encodeURIComponent(reportId)}`, {
        body: JSON.stringify({ action }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("MODERATION_FAILED");
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((action) => (
        <Button
          disabled={pending !== null}
          key={action}
          onClick={() => void run(action)}
          size="sm"
          type="button"
          variant={action === "takedown" ? "primary" : "outline"}
        >
          {LABELS[action]}
        </Button>
      ))}
      {failed ? (
        <p className="w-full text-sm font-semibold text-red-700" role="alert">
          Chưa thực hiện được. Vui lòng thử lại.
        </p>
      ) : null}
    </div>
  );
}
