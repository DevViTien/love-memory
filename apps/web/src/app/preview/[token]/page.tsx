import { Container } from "@love-memory/ui";
import { type Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { getPreviewService } from "@/composition/preview";
import { getGiftRequestContextFromHeaders } from "@/modules/gifts/presentation/gift-route-helpers";
import { PreviewScreen } from "@/modules/preview/presentation/preview-screen";

type PreviewPageProps = Readonly<{
  params: Promise<{ token: string }>;
}>;

export const dynamic = "force-dynamic";

// Static metadata only: gift text never reaches the document head.
export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Xem trước quà",
};

export default async function PreviewPage({ params }: PreviewPageProps) {
  const { token } = await params;
  const service = getPreviewService();
  const opened = await service.openPreview(token);
  if (!opened) {
    notFound();
  }

  // The token grants the read only. Edit links follow the Studio's own rule for this browser.
  const context = await getGiftRequestContextFromHeaders(await headers());
  const canEdit = await service.canEditDraft({
    accessors: context.accessors,
    publicId: opened.publicId,
  });

  return (
    <main>
      <Container className="py-8 sm:py-12">
        <h1 className="mb-6 text-3xl font-black tracking-tight text-stone-900">Xem trước quà</h1>
        <PreviewScreen canEdit={canEdit} publicId={opened.publicId} viewer={opened.viewer} />
      </Container>
    </main>
  );
}
