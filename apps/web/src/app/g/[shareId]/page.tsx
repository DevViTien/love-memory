import { Container } from "@love-memory/ui";
import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { getPublicGiftService } from "@/composition/public-gifts";
import { PublicGiftScreen } from "@/modules/public-gifts/presentation/public-gift-screen";

type PublicGiftPageProps = Readonly<{
  params: Promise<{ shareId: string }>;
}>;

export const dynamic = "force-dynamic";

const GENERIC_TITLE = "Một món quà dành cho bạn";
const GENERIC_DESCRIPTION = "Ai đó đã gửi cho bạn một món quà kỷ niệm trên LoveMemory.";

// Static and generic: no gift text, recipient name or creator identity ever reaches the head.
export const metadata: Metadata = {
  description: GENERIC_DESCRIPTION,
  openGraph: { description: GENERIC_DESCRIPTION, title: GENERIC_TITLE },
  robots: { follow: false, index: false },
  title: GENERIC_TITLE,
};

export default async function PublicGiftPage({ params }: PublicGiftPageProps) {
  const { shareId } = await params;
  const page = await getPublicGiftService().resolvePublicGiftPage(shareId);
  if (!page) {
    notFound();
  }

  // Only the share id, the analytics context (a pseudonym and the template version, never
  // content) and the plan's watermark flag cross to the client; the content loads after the tap.
  return (
    <main>
      <Container className="py-6 sm:py-10">
        <PublicGiftScreen analytics={page.analytics} shareId={shareId} watermark={page.watermark} />
      </Container>
    </main>
  );
}
