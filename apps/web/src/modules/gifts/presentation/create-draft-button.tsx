"use client";

import { GiftDraftResponseSchema } from "@love-memory/contracts";
import { Button } from "@love-memory/ui";
import { type Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateDraftButton({
  templateId,
  templateVersion,
}: Readonly<{ templateId: string; templateVersion: string }>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [isPending, setIsPending] = useState(false);

  async function createDraft() {
    setError(null);
    setIsPending(true);

    try {
      const response = await fetch("/api/gifts", {
        body: JSON.stringify({ templateId, templateVersion }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        method: "POST",
      });
      const payload: unknown = await response.json();
      const parsed = GiftDraftResponseSchema.safeParse(
        typeof payload === "object" && payload !== null && "data" in payload ? payload.data : null,
      );

      if (!response.ok || !parsed.success) {
        throw new Error("create-failed");
      }

      router.push(`/studio/${parsed.data.gift.publicId}` as Route);
    } catch {
      setError("Chưa thể tạo bản nháp. Vui lòng thử lại.");
      setIsPending(false);
    }
  }

  return (
    <div>
      <Button disabled={isPending} onClick={() => void createDraft()} size="lg">
        {isPending ? "Đang tạo bản nháp…" : "Bắt đầu với template này"}
      </Button>
      {error ? (
        <p aria-live="polite" className="mt-3 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
