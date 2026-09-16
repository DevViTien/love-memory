"use client";

import {
  ApiErrorResponseSchema,
  GiftDraftResponseSchema,
  type GiftDraftDto,
} from "@love-memory/contracts";
import { type TemplateManifest } from "@love-memory/template-sdk";
import { Button } from "@love-memory/ui";
import { useState } from "react";

type DraftEditorProps = Readonly<{
  gift: GiftDraftDto;
  manifest: TemplateManifest;
}>;

export function DraftEditor({ gift: initialGift, manifest }: DraftEditorProps) {
  const [content, setContent] = useState<Readonly<Record<string, unknown>>>(initialGift.content);
  const [gift, setGift] = useState(initialGift);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  function setField(id: string, value: string) {
    setContent((current) => {
      const next = { ...current };
      if (value === "") {
        delete next[id];
      } else {
        next[id] = value;
      }
      return next;
    });
  }

  async function save() {
    setIsPending(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/gifts/${gift.publicId}`, {
        body: JSON.stringify({ content, expectedRevision: gift.revision }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload: unknown = await response.json();

      if (response.status === 409) {
        const conflict = ApiErrorResponseSchema.safeParse(payload);
        const actual = conflict.success ? conflict.data.error.details?.["actualRevision"] : null;
        setMessage(
          typeof actual === "number"
            ? `Bản nháp đã có revision ${actual}. Hãy tải lại trang trước khi lưu tiếp.`
            : "Bản nháp đã được cập nhật ở nơi khác. Hãy tải lại trang.",
        );
        return;
      }

      const parsed = GiftDraftResponseSchema.safeParse(
        typeof payload === "object" && payload !== null && "data" in payload ? payload.data : null,
      );
      if (!response.ok || !parsed.success) {
        const apiError = ApiErrorResponseSchema.safeParse(payload);
        setMessage(
          apiError.success && apiError.data.error.code === "VALIDATION_ERROR"
            ? "Một số nội dung chưa đúng giới hạn của template."
            : "Chưa thể lưu bản nháp. Vui lòng thử lại.",
        );
        return;
      }

      setGift(parsed.data.gift);
      setContent(parsed.data.gift.content);
      setMessage(`Đã lưu revision ${parsed.data.gift.revision}.`);
    } catch {
      setMessage("Mất kết nối khi lưu. Nội dung trên màn hình vẫn được giữ lại.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-6">
      {manifest.fields.map((field) => {
        const value = typeof content[field.id] === "string" ? String(content[field.id]) : "";

        if (field.type === "imageList" || field.type === "audio") {
          return (
            <div
              className="rounded-2xl border border-dashed border-rose-200 bg-rose-50/60 p-5"
              key={field.id}
            >
              <p className="font-bold text-stone-800">{field.label}</p>
              <p className="mt-1 text-sm text-stone-600">
                Trình tải media sẽ được nối vào asset pipeline trong Sprint 2.
              </p>
            </div>
          );
        }

        if (field.type === "theme") {
          return (
            <label className="block" key={field.id}>
              <span className="text-sm font-bold text-stone-800">{field.label}</span>
              <select
                className="mt-2 h-12 w-full rounded-2xl border border-rose-200 bg-white px-4"
                onChange={(event) => setField(field.id, event.target.value)}
                required={field.required}
                value={value}
              >
                <option value="">Chọn một chủ đề</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          );
        }

        return (
          <label className="block" key={field.id}>
            <span className="text-sm font-bold text-stone-800">{field.label}</span>
            {field.type === "longText" ? (
              <textarea
                className="mt-2 min-h-32 w-full rounded-2xl border border-rose-200 bg-white p-4"
                maxLength={field.maxLength}
                onChange={(event) => setField(field.id, event.target.value)}
                required={field.required}
                value={value}
              />
            ) : (
              <input
                className="mt-2 h-12 w-full rounded-2xl border border-rose-200 bg-white px-4"
                maxLength={field.type === "shortText" ? field.maxLength : undefined}
                onChange={(event) => setField(field.id, event.target.value)}
                required={field.required}
                type={field.type === "date" ? "date" : "text"}
                value={value}
              />
            )}
          </label>
        );
      })}
      <div className="flex flex-wrap items-center gap-4 border-t border-rose-100 pt-6">
        <Button disabled={isPending} onClick={() => void save()} size="lg">
          {isPending ? "Đang lưu…" : "Lưu nội dung"}
        </Button>
        <span className="text-sm font-semibold text-stone-500">Revision {gift.revision}</span>
      </div>
      {message ? (
        <p
          aria-live="polite"
          className="rounded-2xl bg-stone-100 p-4 text-sm font-semibold text-stone-700"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
