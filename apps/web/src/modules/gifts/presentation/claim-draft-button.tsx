"use client";

import { Button } from "@love-memory/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ClaimDraftButton({ publicId }: Readonly<{ publicId: string }>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function claim() {
    setError(null);
    setIsPending(true);
    try {
      const response = await fetch(`/api/gifts/${publicId}/claim`, {
        body: "{}",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        setError("Không thể liên kết bản nháp này với tài khoản.");
        setIsPending(false);
        return;
      }

      router.refresh();
    } catch {
      setError("Mất kết nối khi liên kết bản nháp. Vui lòng thử lại.");
      setIsPending(false);
    }
  }

  return (
    <div>
      <Button disabled={isPending} onClick={() => void claim()} variant="outline">
        {isPending ? "Đang liên kết…" : "Lưu bản nháp vào tài khoản"}
      </Button>
      {error ? (
        <p aria-live="polite" className="mt-2 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
