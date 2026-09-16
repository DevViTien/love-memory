import { Container } from "@love-memory/ui";

export default function TemplatesLoading() {
  return (
    <main aria-busy="true" aria-label="Đang tải kho template">
      <Container className="py-16">
        <div className="h-16 max-w-2xl animate-pulse rounded-3xl bg-rose-100/80" />
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div className="h-80 animate-pulse rounded-[2rem] bg-rose-100/70" key={item} />
          ))}
        </div>
      </Container>
    </main>
  );
}
