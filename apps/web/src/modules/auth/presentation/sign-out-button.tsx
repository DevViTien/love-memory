"use client";

import { Button } from "@love-memory/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/composition/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function signOut() {
    setError(null);
    setIsPending(true);

    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError("Chưa thể đăng xuất lúc này. Vui lòng thử lại.");
        return;
      }
      router.refresh();
    } catch {
      setError("Mất kết nối khi đăng xuất. Vui lòng thử lại.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div>
      <Button disabled={isPending} onClick={() => void signOut()} variant="outline">
        {isPending ? "Đang đăng xuất…" : "Đăng xuất"}
      </Button>
      {error ? (
        <p aria-live="polite" className="mt-3 text-sm font-semibold text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
