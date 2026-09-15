import { ROUTES } from "@love-memory/shared";
import { Badge, buttonVariants, cn, Container } from "@love-memory/ui";
import Link from "next/link";

import { getPublishedTemplates } from "@/composition/templates";
import { TemplateGallery } from "@/modules/templates/presentation/template-gallery";

const productPromises = [
  "Không cần cài ứng dụng",
  "Riêng tư ngay từ mặc định",
  "Xem đẹp trên điện thoại",
] as const;

export default function HomePage() {
  const templates = getPublishedTemplates();

  return (
    <main>
      <Container className="py-16 sm:py-24">
        <section className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <Badge>Story-first, không chỉ là một hiệu ứng</Badge>
            <h1 className="mt-6 max-w-3xl text-5xl leading-[1.03] font-black tracking-[-0.04em] text-stone-900 sm:text-7xl">
              Biến ký ức của hai người thành một món quà biết kể chuyện.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-600">
              Chọn một câu chuyện, thêm ảnh và lời nhắn. LoveMemory tạo một trải nghiệm mở quà tương
              tác cùng đường link và QR dành riêng cho người ấy.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link className={buttonVariants({ size: "lg" })} href={ROUTES.templates}>
                Khám phá template
              </Link>
              <a
                className={cn(buttonVariants({ size: "lg", variant: "outline" }))}
                href="#templates"
              >
                Xem cách hoạt động
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-stone-600">
              {productPromises.map((promise) => (
                <li className="flex items-center gap-2" key={promise}>
                  <span aria-hidden className="text-rose-600">
                    ♥
                  </span>
                  {promise}
                </li>
              ))}
            </ul>
          </div>

          <div
            aria-label="Minh họa món quà kỷ niệm"
            className="relative mx-auto aspect-[4/5] w-full max-w-md overflow-hidden rounded-[2.5rem] border border-white/80 bg-stone-950 p-6 shadow-2xl shadow-rose-200/70"
            role="img"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(244,63,94,0.35),transparent_36%),radial-gradient(circle_at_80%_80%,rgba(251,146,60,0.24),transparent_30%)]" />
            <div className="relative flex h-full flex-col justify-between rounded-[2rem] border border-white/15 p-6 text-white">
              <p className="text-sm tracking-[0.22em] text-rose-200 uppercase">Chỉ dành cho An</p>
              <div className="text-center">
                <div className="mx-auto grid size-28 place-items-center rounded-3xl bg-rose-500 text-5xl shadow-xl shadow-rose-950/40">
                  🎁
                </div>
                <p className="mt-8 text-3xl font-bold">Chạm để mở ký ức</p>
                <p className="mt-3 text-sm text-stone-300">Minh đã để lại một điều cho bạn.</p>
              </div>
              <p className="text-center text-xs text-stone-400">LoveMemory · 01:15</p>
            </div>
          </div>
        </section>
      </Container>

      <section className="border-y border-rose-100/80 bg-white/65 py-16" id="templates">
        <Container>
          <div className="mb-9 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-bold tracking-[0.2em] text-rose-700 uppercase">
                Ba câu chuyện đầu tiên
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-stone-900 sm:text-4xl">
                Ít template, nhưng mỗi mẫu đều đáng nhớ.
              </h2>
            </div>
            <Link
              className="font-semibold text-rose-700 underline decoration-rose-300 underline-offset-4"
              href={ROUTES.templates}
            >
              Xem tất cả
            </Link>
          </div>
          <TemplateGallery templates={templates} />
        </Container>
      </section>
    </main>
  );
}
