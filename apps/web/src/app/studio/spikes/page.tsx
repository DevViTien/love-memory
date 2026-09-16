import { Badge, Container } from "@love-memory/ui";
import { notFound } from "next/navigation";

import { getTechnicalSpikeEnvironment } from "@/config/technical-spikes";
import { TechnicalSpikeLab } from "@/modules/spikes/presentation/technical-spike-lab";

export default function TechnicalSpikesPage() {
  const environment = getTechnicalSpikeEnvironment();

  if (!environment.enabled) {
    notFound();
  }

  return (
    <main>
      <Container className="py-12 sm:py-16">
        <div className="mx-auto max-w-4xl">
          <Badge>Sprint 0 verification lab</Badge>
          <h1 className="mt-5 text-4xl font-black tracking-tight text-stone-900">
            Kiểm chứng rủi ro trước Sprint 1
          </h1>
          <p className="mt-4 max-w-3xl leading-7 text-stone-600">
            Trang nội bộ này kiểm tra Vercel Blob upload, MongoDB pool, iframe isolation và audio
            fallback. Mutation endpoints bị tắt mặc định và yêu cầu bearer token riêng.
          </p>
          <div className="mt-10">
            <TechnicalSpikeLab spikesEnabled={environment.enabled} />
          </div>
        </div>
      </Container>
    </main>
  );
}
