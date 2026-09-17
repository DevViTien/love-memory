import { APP_CONFIG, ROUTES } from "@love-memory/shared";
import { buttonVariants, Container } from "@love-memory/ui";
import Link from "next/link";

import { AuthStatusLink } from "@/modules/auth/presentation/auth-status-link";

export function SiteHeader() {
  return (
    <header className="border-b border-rose-100/80 bg-white/70 backdrop-blur">
      <Container className="flex h-16 items-center justify-between gap-6">
        <Link
          aria-label={APP_CONFIG.name + " — Trang chủ"}
          className="text-xl font-black tracking-[-0.03em] text-stone-900"
          href={ROUTES.home}
        >
          Love<span className="text-rose-600">Memory</span>
        </Link>
        <nav aria-label="Điều hướng chính" className="flex items-center gap-2">
          <Link
            className="hidden px-3 py-2 text-sm font-semibold text-stone-600 hover:text-rose-700 sm:block"
            href={ROUTES.templates}
          >
            Template
          </Link>
          <AuthStatusLink />
          <Link className={buttonVariants({ size: "sm" })} href={ROUTES.studioNew}>
            Tạo kỷ niệm
          </Link>
        </nav>
      </Container>
    </header>
  );
}
