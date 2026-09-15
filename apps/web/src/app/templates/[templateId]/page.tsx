import { ROUTES } from "@love-memory/shared";
import { Badge, buttonVariants, Container } from "@love-memory/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getPublishedTemplateById, getPublishedTemplates } from "@/composition/templates";
import { toTemplateCardViewModel } from "@/modules/templates/presentation/template-card-view-model";

type TemplateDetailPageProps = Readonly<{
  params: Promise<{ templateId: string }>;
}>;

export function generateStaticParams() {
  return getPublishedTemplates().map((template) => ({
    templateId: template.id,
  }));
}

export async function generateMetadata({ params }: TemplateDetailPageProps): Promise<Metadata> {
  const { templateId } = await params;
  const template = getPublishedTemplateById(templateId);

  if (!template) {
    return { title: "Không tìm thấy template" };
  }

  return {
    description: template.description,
    title: template.name,
  };
}

export default async function TemplateDetailPage({ params }: TemplateDetailPageProps) {
  const { templateId } = await params;
  const template = getPublishedTemplateById(templateId);

  if (!template) {
    notFound();
  }

  const viewModel = toTemplateCardViewModel(template);

  return (
    <main>
      <Container className="py-16 sm:py-20">
        <Link
          className="text-sm font-semibold text-stone-600 hover:text-rose-700"
          href={ROUTES.templates}
        >
          ← Quay lại kho template
        </Link>
        <div className="mt-8 grid gap-10 lg:grid-cols-[0.85fr_1.15fr]">
          <div
            className={
              "grid aspect-[4/5] place-items-center rounded-[2.5rem] bg-gradient-to-br " +
              viewModel.gradient +
              " text-8xl shadow-xl shadow-rose-100"
            }
          >
            <span aria-hidden>{viewModel.icon}</span>
          </div>
          <div className="self-center">
            <Badge>{viewModel.moodLabel}</Badge>
            <h1 className="mt-5 text-5xl font-black tracking-tight text-stone-900">
              {template.name}
            </h1>
            <p className="mt-5 text-lg leading-8 text-stone-600">{template.description}</p>
            <dl className="mt-8 grid grid-cols-2 gap-4 rounded-3xl border border-rose-100 bg-white/75 p-6">
              <div>
                <dt className="text-xs font-bold tracking-wider text-stone-500 uppercase">
                  Thời lượng
                </dt>
                <dd className="mt-1 font-bold text-stone-900">{viewModel.durationLabel}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold tracking-wider text-stone-500 uppercase">
                  Số ảnh
                </dt>
                <dd className="mt-1 font-bold text-stone-900">{viewModel.photoRequirement}</dd>
              </div>
            </dl>
            <Link
              className={buttonVariants({ size: "lg" })}
              href={`${ROUTES.studioNew}?template=${template.id}`}
            >
              Dùng template này
            </Link>
          </div>
        </div>
      </Container>
    </main>
  );
}
