import { Container } from "@love-memory/ui";
import type { Metadata } from "next";
import { headers } from "next/headers";

import { getCurrentUser } from "@/composition/session";
import { MagicLinkForm } from "@/modules/auth/presentation/magic-link-form";
import { SignOutButton } from "@/modules/auth/presentation/sign-out-button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: "Đăng nhập LoveMemory bằng liên kết email dùng một lần.",
  title: "Đăng nhập",
};

type SignInPageProps = Readonly<{
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
}>;

function safeCallbackUrl(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.startsWith("/") && !candidate.startsWith("//") ? candidate : "/studio/new";
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const query = await searchParams;
  const user = await getCurrentUser(await headers());
  const callbackUrl = safeCallbackUrl(query.next);
  const rawError = Array.isArray(query.error) ? query.error[0] : query.error;
  const errorMessage =
    rawError === "invalid-link"
      ? "Liên kết đăng nhập không hợp lệ, đã hết hạn hoặc đã được sử dụng. Vui lòng yêu cầu liên kết mới."
      : null;

  return (
    <main>
      <Container className="py-16 sm:py-24">
        <section className="mx-auto max-w-lg rounded-[2rem] border border-rose-100 bg-white/90 p-7 shadow-xl shadow-rose-100/60 sm:p-10">
          <p className="text-sm font-bold tracking-[0.2em] text-rose-700 uppercase">Creator</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-stone-900">
            {user ? "Bạn đã đăng nhập" : "Đăng nhập không cần mật khẩu"}
          </h1>
          <p className="mt-4 leading-7 text-stone-600">
            {user
              ? `Phiên hiện tại thuộc về ${user.email}.`
              : "Nhập email để nhận liên kết dùng một lần. Người nhận quà không cần tạo tài khoản."}
          </p>
          <div className="mt-8">
            {!user && errorMessage ? (
              <p
                aria-live="polite"
                className="mb-5 rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-800"
                role="alert"
              >
                {errorMessage}
              </p>
            ) : null}
            {user ? <SignOutButton /> : <MagicLinkForm callbackUrl={callbackUrl} />}
          </div>
        </section>
      </Container>
    </main>
  );
}
