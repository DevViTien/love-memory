import { Container } from "@love-memory/ui";

export default function StudioDraftLoading() {
  return (
    <main aria-busy="true" aria-label="Đang tải bản nháp">
      <Container className="py-14">
        <div className="h-96 animate-pulse rounded-[2rem] bg-rose-100/70" />
      </Container>
    </main>
  );
}
