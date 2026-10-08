import { ROUTES } from "@love-memory/shared";
import { buttonVariants, Container } from "@love-memory/ui";
import Link from "next/link";

/** One page for every cause: unknown, malformed, unpublished, expired or unreadable share links. */
export default function PublicGiftNotFound() {
  return (
    <main>
      <Container className="grid min-h-[70vh] place-items-center py-20 text-center">
        <div>
          <h1 className="text-3xl font-black text-stone-900">
            Món quà không tồn tại, đã hết hạn hoặc đã được thu hồi.
          </h1>
          <p className="mt-4 text-stone-600">
            Hãy kiểm tra lại đường dẫn hoặc hỏi người đã gửi quà cho bạn.
          </p>
          <Link className={buttonVariants({ className: "mt-8", size: "lg" })} href={ROUTES.home}>
            Về trang chủ
          </Link>
        </div>
      </Container>
    </main>
  );
}
