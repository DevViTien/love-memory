"use client";

import { Button, Container } from "@love-memory/ui";
import { useEffect } from "react";

import { reportClientBoundaryError } from "@/observability/operational-errors";

type ErrorPageProps = Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>;

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    reportClientBoundaryError(error);
  }, [error]);

  return (
    <main>
      <Container className="grid min-h-[70vh] place-items-center py-20 text-center">
        <div>
          <p className="text-sm font-bold tracking-[0.2em] text-rose-700 uppercase">
            Có một nhịp bị lỡ
          </p>
          <h1 className="mt-3 text-4xl font-black text-stone-900">
            LoveMemory chưa thể tải nội dung.
          </h1>
          <p className="mt-4 text-stone-600">Bạn có thể thử lại mà không mất nội dung đã lưu.</p>
          <Button className="mt-7" onClick={reset} size="lg">
            Thử lại
          </Button>
        </div>
      </Container>
    </main>
  );
}
