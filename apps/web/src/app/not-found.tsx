import { ROUTES } from "@love-memory/shared";
import { buttonVariants, Container } from "@love-memory/ui";
import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <Container className="grid min-h-[70vh] place-items-center py-20 text-center">
        <div>
          <p className="text-sm font-bold tracking-[0.2em] text-rose-700 uppercase">404</p>
          <h1 className="mt-3 text-4xl font-black text-stone-900">Kỷ niệm này chưa tồn tại.</h1>
          <p className="mt-4 text-stone-600">
            Đường dẫn có thể đã thay đổi, hết hạn hoặc được chủ sở hữu tạm ẩn.
          </p>
          <Link className={buttonVariants({ size: "lg" })} href={ROUTES.home}>
            Về trang chủ
          </Link>
        </div>
      </Container>
    </main>
  );
}
