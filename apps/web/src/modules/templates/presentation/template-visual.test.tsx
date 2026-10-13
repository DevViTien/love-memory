import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TemplateVisual } from "./template-visual";

const src = `/template-artifacts/memories/1.0.0/${"a".repeat(64)}/assets/thumbnail.jpg`;

describe("TemplateVisual", () => {
  it("shows the template's thumbnail with its alt text instead of the icon", () => {
    const html = renderToStaticMarkup(
      <TemplateVisual
        className="aspect-[4/3]"
        iconClassName="text-6xl"
        template={{
          gradient: "from-pink-100 to-pink-200",
          icon: "📔",
          thumbnail: { alt: "Hình minh họa mẫu quà Kỷ niệm của chúng mình", src },
        }}
      />,
    );

    expect(html).toContain(`src="${src}"`);
    expect(html).toContain('alt="Hình minh họa mẫu quà Kỷ niệm của chúng mình"');
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain("📔");
  });

  it("shows the gradient and the decorative icon without a thumbnail", () => {
    const html = renderToStaticMarkup(
      <TemplateVisual
        className="aspect-[4/5]"
        iconClassName="text-8xl"
        template={{ gradient: "from-stone-100 to-orange-100", icon: "💝", thumbnail: null }}
      />,
    );

    expect(html).not.toContain("<img");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("💝");
    expect(html).toContain("from-stone-100");
  });
});
