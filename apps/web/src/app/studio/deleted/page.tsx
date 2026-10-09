import { ROUTES } from "@love-memory/shared";
import { buttonVariants, Container } from "@love-memory/ui";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Đã xoá món quà",
};

/** Where the Studio goes after a delete (`gift-lifecycle`): the gift has no page any more. */
export default function DeletedGiftPage() {
  return (
    <main>
      <Container className="max-w-xl py-16 sm:py-24">
        <section className="rounded-[2rem] border border-rose-100 bg-white/90 p-7 shadow-xl shadow-rose-100/60 sm:p-10">
          <h1 className="text-3xl font-black tracking-tight text-stone-900">Đã xoá món quà.</h1>
          <p className="mt-4 leading-7 text-stone-600">
            Người nhận không còn mở được món quà. Ảnh và nội dung sẽ được xoá hẳn trong vòng 24 giờ.
          </p>
          <Link className={`mt-8 ${buttonVariants({ size: "lg" })}`} href={ROUTES.studioNew}>
            Tạo món quà mới
          </Link>
        </section>
      </Container>
    </main>
  );
}
