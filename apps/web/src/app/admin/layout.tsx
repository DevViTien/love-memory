import { Container } from "@love-memory/ui";
import Link from "next/link";
import { connection } from "next/server";
import { type ReactNode } from "react";

/**
 * The admin shell. It renders no admin data: every page enforces the admin guard itself, so a
 * non-admin gets the not-found page from the page, never a shell that confirms the area exists.
 */
export default async function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Per-request nonce CSP and session-dependent content: never prerendered.
  await connection();

  return (
    <main>
      <Container className="py-8 sm:py-10">
        <nav aria-label="Quản trị" className="mb-6 flex gap-4 text-sm font-bold text-stone-700">
          <Link href="/admin">Quản trị</Link>
          <Link href="/admin/audit">Nhật ký</Link>
        </nav>
        {children}
      </Container>
    </main>
  );
}
