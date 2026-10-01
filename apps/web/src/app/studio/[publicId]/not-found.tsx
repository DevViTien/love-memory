import { ROUTES } from "@love-memory/shared";
import { buttonVariants, Container } from "@love-memory/ui";
import Link from "next/link";

/**
 * One page for every cause (unknown draft, no access, another owner), so it reveals nothing. It
 * explains the most common one: a sign-in link opened in a browser that does not hold the draft.
 */
export default function StudioDraftNotFound() {
  return (
    <main>
      <Container className="grid min-h-[60vh] place-items-center py-20 text-center">
        <div className="max-w-xl">
          <h1 className="text-3xl font-black text-stone-900">Không mở được bản nháp này</h1>
          <p className="mt-4 leading-7 text-stone-600">
            Bản nháp tạo khi chưa đăng nhập chỉ mở được trên trình duyệt đã tạo ra nó. Hãy mở lại
            trình duyệt hoặc điện thoại bạn đã dùng để tạo quà, đăng nhập ở đó để lưu quà vào tài
            khoản.
          </p>
          <Link
            className={buttonVariants({ className: "mt-8", size: "lg" })}
            href={ROUTES.templates}
          >
            Xem các mẫu quà
          </Link>
        </div>
      </Container>
    </main>
  );
}
