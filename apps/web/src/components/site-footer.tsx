import { Container } from "@love-memory/ui";
import Link from "next/link";

/** On every page (`privacy-notice` "Privacy links"). */
export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-rose-100 py-6 text-sm text-stone-500">
      <Container className="flex flex-wrap items-center justify-between gap-3">
        <p>LoveMemory</p>
        <Link className="font-semibold underline" href="/privacy">
          Quyền riêng tư
        </Link>
      </Container>
    </footer>
  );
}
