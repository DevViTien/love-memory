"use client";

import { ROUTES } from "@love-memory/shared";
import Link from "next/link";

import { authClient } from "@/composition/auth-client";

export function AuthStatusLink() {
  const { data: session } = authClient.useSession();
  const label = session?.user ? "Tài khoản" : "Đăng nhập";

  return (
    <Link
      className="px-2 py-2 text-sm font-semibold text-stone-600 hover:text-rose-700 sm:px-3"
      href={{ pathname: ROUTES.authSignIn }}
    >
      {label}
    </Link>
  );
}
