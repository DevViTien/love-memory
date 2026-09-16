"use client";

import { Button } from "@love-memory/ui";
import { type FormEvent, useState } from "react";

import { authClient } from "@/composition/auth-client";

export function MagicLinkForm({ callbackUrl = "/studio/new" }: Readonly<{ callbackUrl?: string }>) {
  const [email, setEmail] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [state, setState] = useState<"editing" | "error" | "sent">("editing");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setState("editing");

    try {
      const result = await authClient.signIn.magicLink({
        callbackURL: callbackUrl,
        email,
        errorCallbackURL: "/auth/sign-in?error=invalid-link",
        newUserCallbackURL: callbackUrl,
      });
      setState(result.error ? "error" : "sent");
    } catch {
      setState("error");
    } finally {
      setIsPending(false);
    }
  }

  if (state === "sent") {
    return (
      <div aria-live="polite" className="rounded-2xl bg-emerald-50 p-5 text-emerald-900">
        <p className="font-bold">Kiểm tra hộp thư của bạn</p>
        <p className="mt-2 text-sm leading-6">
          Nếu địa chỉ hợp lệ, LoveMemory đã gửi một liên kết đăng nhập dùng một lần. Liên kết hết
          hạn sau 10 phút.
        </p>
      </div>
    );
  }

  return (
    <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
      <div>
        <label className="text-sm font-bold text-stone-800" htmlFor="email">
          Email của bạn
        </label>
        <input
          autoComplete="email"
          className="mt-2 h-12 w-full rounded-2xl border border-rose-200 bg-white px-4 text-stone-900 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
          id="email"
          maxLength={254}
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="ban@example.com"
          required
          type="email"
          value={email}
        />
      </div>
      {state === "error" ? (
        <p aria-live="polite" className="text-sm font-semibold text-red-700">
          Chưa thể gửi email lúc này. Vui lòng thử lại sau ít phút.
        </p>
      ) : null}
      <Button className="w-full" disabled={isPending} size="lg" type="submit">
        {isPending ? "Đang gửi…" : "Gửi liên kết đăng nhập"}
      </Button>
      <p className="text-xs leading-5 text-stone-500">
        Vì an toàn, hệ thống luôn trả cùng một thông báo dù email đã có tài khoản hay chưa.
      </p>
    </form>
  );
}
