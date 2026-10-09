"use client";

import { Button } from "@love-memory/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  TEMPLATE_KILL_REASONS,
  type TemplateKillReason,
} from "../application/template-version-controls";

export const KILL_REASON_LABELS: Readonly<Record<TemplateKillReason, string>> = {
  broken: "Lỗi hiển thị (broken)",
  legal: "Pháp lý (legal)",
  other: "Khác (other)",
  security: "Bảo mật (security)",
};

type Action = "kill" | "restore" | "retire";

const CONFIRMATIONS: Readonly<Record<Action, string>> = {
  kill: "Tắt khẩn cấp phiên bản này? Mọi món quà dùng nó sẽ chỉ hiện nội dung tĩnh và không xuất bản được cho tới khi khôi phục.",
  restore: "Khôi phục phiên bản này? Các món quà đã đăng sẽ dùng lại hiệu ứng của mẫu.",
  retire:
    "Ngừng phát hành phiên bản này? Không thể tạo bản nháp mới trên nó; nếu là phiên bản hiện tại, mẫu quà sẽ rời khỏi danh mục.",
};

/**
 * The actions of one row of `/admin/templates` (`template-version-controls`): each asks for
 * confirmation, sends the change and refreshes the server-rendered list.
 */
export function TemplateVersionActions({
  confirm = (message: string) => window.confirm(message),
  killed,
  status,
  templateId,
  version,
}: Readonly<{
  confirm?: (message: string) => boolean;
  killed: boolean;
  status: "draft" | "published" | "retired";
  templateId: string;
  version: string;
}>) {
  const router = useRouter();
  const [reason, setReason] = useState<TemplateKillReason>("broken");
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (status === "draft") return null;

  async function run(action: Action) {
    if (!confirm(CONFIRMATIONS[action])) return;
    setPending(action);
    setError(null);
    try {
      const response = await fetch("/api/admin/template-versions", {
        body: JSON.stringify({
          action,
          ...(action === "kill" ? { reason } : {}),
          templateId,
          version,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("ACTION_FAILED");
      router.refresh();
    } catch {
      setError("Chưa thực hiện được. Vui lòng thử lại.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "published" ? (
        <Button
          disabled={pending !== null}
          onClick={() => void run("retire")}
          size="sm"
          type="button"
          variant="outline"
        >
          Ngừng phát hành
        </Button>
      ) : null}
      {killed ? (
        <Button
          disabled={pending !== null}
          onClick={() => void run("restore")}
          size="sm"
          type="button"
          variant="outline"
        >
          Khôi phục
        </Button>
      ) : (
        <>
          <label className="sr-only" htmlFor={`kill-reason-${templateId}-${version}`}>
            Lý do tắt
          </label>
          <select
            className="h-9 rounded-xl border border-stone-300 bg-white px-2 text-sm"
            id={`kill-reason-${templateId}-${version}`}
            onChange={(event) => setReason(event.target.value as TemplateKillReason)}
            value={reason}
          >
            {TEMPLATE_KILL_REASONS.map((value) => (
              <option key={value} value={value}>
                {KILL_REASON_LABELS[value]}
              </option>
            ))}
          </select>
          <Button
            disabled={pending !== null}
            onClick={() => void run("kill")}
            size="sm"
            type="button"
            variant="primary"
          >
            Tắt khẩn cấp
          </Button>
        </>
      )}
      {error ? (
        <p className="w-full text-sm font-semibold text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
