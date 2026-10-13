import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type TemplateSummary } from "@/modules/templates/domain/template-summary";

const templates = vi.hoisted(() => ({ getPublishedTemplateById: vi.fn() }));
const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/composition/templates", () => templates);
vi.mock("next/navigation", () => navigation);

import TemplateDetailPage, { generateMetadata } from "./page";

/** A published template whose current version has no registered artifact. */
const unavailable: TemplateSummary = {
  available: false,
  description: "Một mẫu quà đang được hoàn thiện.",
  estimatedDurationSec: 60,
  id: "future-template",
  moods: ["dreamy"],
  name: "Mẫu quà tương lai",
  version: "1.0.0",
};

async function render(templateId: string): Promise<string> {
  return renderToStaticMarkup(
    await TemplateDetailPage({ params: Promise.resolve({ templateId }) }),
  );
}

beforeEach(() => {
  templates.getPublishedTemplateById.mockReset();
});

describe("template detail page", () => {
  it("shows Sắp ra mắt and no Studio link for a template without an artifact (Template that is not yet available)", async () => {
    templates.getPublishedTemplateById.mockResolvedValue(unavailable);

    const html = await render("future-template");

    expect(html).toContain("Mẫu quà tương lai");
    expect(html).toContain("Sắp ra mắt");
    expect(html).toContain("Mẫu quà này đang được hoàn thiện, bạn chưa thể tạo quà từ mẫu này.");
    expect(html).not.toContain("/studio/new?template=future-template");
    expect(html).not.toContain("<img");
  });

  it("offers the Studio link and the thumbnail for an available html template", async () => {
    templates.getPublishedTemplateById.mockResolvedValue({
      ...unavailable,
      available: true,
      thumbnailUrl: `/template-artifacts/future-template/1.0.0/${"a".repeat(64)}/assets/thumbnail.jpg`,
    });

    const html = await render("future-template");

    expect(html).toContain("/studio/new?template=future-template");
    expect(html).toContain('alt="Hình minh họa mẫu quà Mẫu quà tương lai"');
    expect(html).not.toContain("Sắp ra mắt");
  });

  it("renders the not-found page for an unknown, unpublished or retired template", async () => {
    templates.getPublishedTemplateById.mockResolvedValue(undefined);

    await expect(render("midnight-wish")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(templates.getPublishedTemplateById).toHaveBeenCalledWith("midnight-wish");
    expect(navigation.notFound).toHaveBeenCalledTimes(1);
  });

  it("names the template in its metadata, or says it was not found", async () => {
    templates.getPublishedTemplateById.mockResolvedValueOnce(unavailable);
    await expect(
      generateMetadata({ params: Promise.resolve({ templateId: "future-template" }) }),
    ).resolves.toEqual({ description: unavailable.description, title: unavailable.name });

    templates.getPublishedTemplateById.mockResolvedValueOnce(undefined);
    await expect(
      generateMetadata({ params: Promise.resolve({ templateId: "midnight-wish" }) }),
    ).resolves.toEqual({ title: "Không tìm thấy template" });
  });
});
