import { Container } from "@love-memory/ui";

export default function Loading() {
  return (
    <Container aria-busy="true" aria-live="polite" className="py-20">
      <div className="h-8 w-48 animate-pulse rounded-full bg-rose-100" />
      <div className="mt-6 h-14 max-w-2xl animate-pulse rounded-2xl bg-stone-200" />
      <p className="sr-only">Đang tải nội dung…</p>
    </Container>
  );
}
