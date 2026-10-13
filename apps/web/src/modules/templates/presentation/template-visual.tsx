import { cn } from "@love-memory/ui";

import { type TemplateCardViewModel } from "./template-card-view-model";

type TemplateVisualProps = Readonly<{
  /** The frame: its aspect ratio, rounding and shadow. */
  className: string;
  /** Size of the icon shown without a thumbnail (`text-6xl`, `text-8xl`). */
  iconClassName: string;
  template: Pick<TemplateCardViewModel, "gradient" | "icon" | "thumbnail">;
}>;

/**
 * The picture of a catalog entry: the template's own thumbnail (a portrait phone screenshot,
 * served from its artifact on this origin) on its gradient, or the gradient and icon without one.
 */
export function TemplateVisual({ className, iconClassName, template }: TemplateVisualProps) {
  return (
    <div
      className={cn(
        "grid place-items-center overflow-hidden bg-gradient-to-br",
        template.gradient,
        className,
      )}
    >
      {template.thumbnail ? (
        // A same-origin, content-addressed artifact file: no image optimization needed.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={template.thumbnail.alt}
          className="h-[86%] w-auto rounded-2xl object-cover shadow-lg ring-4 ring-white/70 transition-transform group-hover:scale-105"
          decoding="async"
          height={600}
          loading="lazy"
          src={template.thumbnail.src}
          width={300}
        />
      ) : (
        <span
          aria-hidden
          className={cn("transition-transform group-hover:scale-110", iconClassName)}
        >
          {template.icon}
        </span>
      )}
    </div>
  );
}
