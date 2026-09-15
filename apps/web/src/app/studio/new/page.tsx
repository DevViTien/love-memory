import { ROUTES } from "@love-memory/shared";
import { Badge, buttonVariants, Container } from "@love-memory/ui";
import Link from "next/link";

import { getPublishedTemplateById } from "@/composition/templates";

type NewStudioPageProps = Readonly<{
  searchParams: Promise<{ template?: string | string[] }>;
}>;

const foundationSteps = [
  "Nội dung và form sẽ được sinh từ manifest của template.",
  "Ảnh sẽ tải thẳng vào object storage và xử lý ở background job.",
  "Preview và gift đã publish dùng cùng một template artifact.",
  "Publish sẽ tạo snapshot bất biến với URL và QR riêng.",
] as const;

export default async function NewStudioPage({ searchParams }: NewStudioPageProps) {
  const rawTemplateId = (await searchParams).template;
  const templateId = Array.isArray(rawTemplateId) ? rawTemplateId[0] : rawTemplateId;
  const template = templateId ? getPublishedTemplateById(templateId) : undefined;

  return (
    <main>
      <Container className="py-16 sm:py-20">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-rose-100 bg-white/85 p-7 shadow-xl shadow-rose-100/60 sm:p-10">
          <Badge>Engineering foundation</Badge>
          <h1 className="mt-5 text-4xl font-black tracking-tight text-stone-900">
            {template ? "Studio · " + template.name : "Chọn template trước khi bắt đầu"}
          </h1>
          <p className="mt-4 leading-7 text-stone-600">
            Codebase nền đã sẵn sàng. Editor thực tế sẽ được phát triển theo vertical slice trong
            Sprint 1–3 của kế hoạch, không dùng state hoặc dữ liệu giả để mô phỏng một tính năng
            chưa hoàn chỉnh.
          </p>
          <ol className="mt-8 space-y-3">
            {foundationSteps.map((step, index) => (
              <li
                className="flex gap-4 rounded-2xl bg-rose-50/75 p-4 text-sm leading-6 text-stone-700"
                key={step}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-rose-600 font-bold text-white">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <Link className={buttonVariants({ variant: "outline" })} href={ROUTES.templates}>
            Chọn template khác
          </Link>
        </div>
      </Container>
    </main>
  );
}
