import { ROUTES } from "@love-memory/shared";
import { Badge, buttonVariants, Container } from "@love-memory/ui";
import Link from "next/link";

import { getPublishedTemplateById } from "@/composition/templates";
import { CreateDraftButton } from "@/modules/gifts/presentation/create-draft-button";

type NewStudioPageProps = Readonly<{
  searchParams: Promise<{ template?: string | string[] }>;
}>;

export const dynamic = "force-dynamic";

export default async function NewStudioPage({ searchParams }: NewStudioPageProps) {
  const rawTemplateId = (await searchParams).template;
  const templateId = Array.isArray(rawTemplateId) ? rawTemplateId[0] : rawTemplateId;
  const template = templateId ? await getPublishedTemplateById(templateId) : undefined;

  return (
    <main>
      <Container className="py-16 sm:py-20">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-rose-100 bg-white/85 p-7 shadow-xl shadow-rose-100/60 sm:p-10">
          <Badge>Bản nháp mới</Badge>
          <h1 className="mt-5 text-4xl font-black tracking-tight text-stone-900">
            {template ? `Bắt đầu với ${template.name}` : "Chọn template trước khi bắt đầu"}
          </h1>
          <p className="mt-4 leading-7 text-stone-600">
            {template
              ? "LoveMemory sẽ tạo một bản nháp riêng. Bạn có thể bắt đầu ẩn danh và liên kết với tài khoản sau."
              : "Mỗi bản nháp được cố định template và phiên bản ngay từ lúc tạo để nội dung không thay đổi ngoài ý muốn."}
          </p>
          <div className="mt-8">
            {template ? (
              <CreateDraftButton templateId={template.id} templateVersion={template.version} />
            ) : (
              <Link className={buttonVariants({ size: "lg" })} href={ROUTES.templates}>
                Mở kho template
              </Link>
            )}
          </div>
          {template ? (
            <Link
              className={buttonVariants({ className: "mt-4", variant: "outline" })}
              href={ROUTES.templates}
            >
              Chọn template khác
            </Link>
          ) : null}
        </div>
      </Container>
    </main>
  );
}
