"use client";

import { Button } from "@love-memory/ui";
import { type FormEvent, useState } from "react";

import {
  REPORT_CATEGORIES,
  REPORT_DETAILS_MAX_LENGTH,
  type ReportCategory,
} from "../application/abuse-reports";
import { REPORT_CATEGORY_LABELS } from "./report-labels";

export const REPORT_THANKS = "Cảm ơn bạn. Chúng tôi sẽ xem xét báo cáo này.";
export const REPORT_ERROR = "Chưa gửi được báo cáo — thử lại.";

/**
 * `Báo cáo nội dung` below the recipient's gift (`abuse-reports`), outside the template's frame.
 * The share id goes in the body: `/g` sends no referrer.
 */
export function ReportGiftForm({ shareId }: Readonly<{ shareId: string }>) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"editing" | "error" | "pending" | "sent">("editing");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!category) return;
    setState("pending");
    try {
      const response = await fetch("/api/reports", {
        body: JSON.stringify({
          category,
          ...(details.trim() ? { details: details.trim() } : {}),
          shareId,
        }),
        credentials: "omit",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      setState(response.status === 202 ? "sent" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <p className="mx-auto mt-4 max-w-md text-center text-sm text-stone-600" role="status">
        {REPORT_THANKS}
      </p>
    );
  }

  if (!open) {
    return (
      <div className="mx-auto mt-4 max-w-md text-center">
        <button
          className="text-xs font-semibold text-stone-500 underline"
          onClick={() => setOpen(true)}
          type="button"
        >
          Báo cáo nội dung
        </button>
      </div>
    );
  }

  return (
    <form
      aria-label="Báo cáo nội dung"
      className="mx-auto mt-4 max-w-md space-y-3 rounded-2xl border border-stone-200 bg-white p-4 text-sm"
      onSubmit={(event) => void submit(event)}
    >
      <fieldset className="space-y-1">
        <legend className="mb-1 font-bold text-stone-800">Món quà này có vấn đề gì?</legend>
        {REPORT_CATEGORIES.map((value) => (
          <label className="flex items-center gap-2" key={value}>
            <input
              checked={category === value}
              name="category"
              onChange={() => setCategory(value)}
              required
              type="radio"
              value={value}
            />
            {REPORT_CATEGORY_LABELS[value]}
          </label>
        ))}
      </fieldset>
      <div>
        <label className="font-bold text-stone-800" htmlFor="report-details">
          Mô tả thêm (không bắt buộc)
        </label>
        <textarea
          className="mt-1 w-full rounded-xl border border-stone-300 p-2"
          id="report-details"
          maxLength={REPORT_DETAILS_MAX_LENGTH}
          onChange={(event) => setDetails(event.target.value)}
          rows={3}
          value={details}
        />
      </div>
      {state === "error" ? (
        <p className="font-semibold text-rose-700" role="alert">
          {REPORT_ERROR}
        </p>
      ) : null}
      <Button disabled={!category || state === "pending"} size="sm" type="submit">
        {state === "pending" ? "Đang gửi…" : "Gửi báo cáo"}
      </Button>
    </form>
  );
}
