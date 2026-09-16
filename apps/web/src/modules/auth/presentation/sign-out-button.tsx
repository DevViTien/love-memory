"use client";

import { Button } from "@love-memory/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/composition/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  return (
    <Button
      disabled={isPending}
      onClick={() => {
        setIsPending(true);
        void authClient.signOut({
          fetchOptions: {
            onSuccess() {
              router.refresh();
              setIsPending(false);
            },
          },
        });
      }}
      variant="outline"
    >
      {isPending ? "Đang đăng xuất…" : "Đăng xuất"}
    </Button>
  );
}
