import { buttonVariants, cn } from "@love-memory/ui";
import Link from "next/link";

import { type TemplateSummary } from "../domain/template-summary";
import { toTemplateCardViewModel } from "./template-card-view-model";

type TemplateGalleryProps = Readonly<{
  className?: string;
  templates: readonly TemplateSummary[];
}>;

export function TemplateGallery({ className, templates }: TemplateGalleryProps) {
  return (
    <div className={cn("grid gap-6 md:grid-cols-3", className)}>
      {templates.map(toTemplateCardViewModel).map((template) => (
        <article
          className="group overflow-hidden rounded-[2rem] border border-rose-100 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl hover:shadow-rose-100"
          key={template.id}
        >
          <div
            className={
              "grid aspect-[4/3] place-items-center bg-gradient-to-br text-6xl " + template.gradient
            }
          >
            <span aria-hidden className="transition-transform group-hover:scale-110">
              {template.icon}
            </span>
          </div>
          <div className="p-6">
            <p className="text-xs font-bold tracking-wider text-rose-700 uppercase">
              {template.moodLabel}
            </p>
            <h3 className="mt-2 text-xl font-black text-stone-900">{template.name}</h3>
            <p className="mt-3 min-h-20 text-sm leading-6 text-stone-600">{template.description}</p>
            <div className="mt-5 flex justify-between text-xs font-semibold text-stone-500">
              <span>{template.durationLabel}</span>
              <span>{template.photoRequirement}</span>
            </div>
            <Link
              className={cn(buttonVariants({ variant: "outline" }), "mt-6 w-full")}
              href={`/templates/${template.id}`}
            >
              Xem câu chuyện
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
