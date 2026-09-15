import { Container } from "@love-memory/ui";
import type { Metadata } from "next";

import { getPublishedTemplates } from "@/composition/templates";
import { TemplateGallery } from "@/modules/templates/presentation/template-gallery";

export const metadata: Metadata = {
  description: "Chọn một câu chuyện để biến ảnh và lời nhắn thành món quà tương tác.",
  title: "Kho template",
};

export default function TemplatesPage() {
  const templates = getPublishedTemplates();

  return (
    <main>
      <Container className="py-16 sm:py-20">
        <div className="max-w-3xl">
          <p className="text-sm font-bold tracking-[0.2em] text-rose-700 uppercase">Kho template</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-stone-900 sm:text-6xl">
            Bạn mang ký ức. LoveMemory giúp kể thành câu chuyện.
          </h1>
          <p className="mt-5 text-lg leading-8 text-stone-600">
            Mỗi template cho biết trước số ảnh, thời lượng và cảm xúc để bạn chọn nhanh mà không cần
            biết thiết kế.
          </p>
        </div>
        <TemplateGallery className="mt-12" templates={templates} />
      </Container>
    </main>
  );
}
