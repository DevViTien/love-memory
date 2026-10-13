import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const templates = vi.hoisted(() => ({ getPublishedTemplateById: vi.fn() }));

vi.mock("@/composition/templates", () => templates);
// The client button is not under test here: it renders the template and version it was given.
vi.mock("@/modules/gifts/presentation/create-draft-button", () => ({
  CreateDraftButton: ({
    templateId,
    templateVersion,
  }: Readonly<{ templateId: string; templateVersion: string }>) => (
    <button type="button">
      Bắt đầu với template này {templateId}@{templateVersion}
    </button>
  ),
}));

import NewStudioPage from "./page";

const summary = {
  available: false,
  description: "Một mẫu quà đang được hoàn thiện.",
  estimatedDurationSec: 60,
  id: "future-template",
  moods: ["dreamy"],
  name: "Mẫu quà tương lai",
  version: "1.0.0",
};

async function render(template?: string): Promise<string> {
  return renderToStaticMarkup(
    await NewStudioPage({ searchParams: Promise.resolve(template ? { template } : {}) }),
  );
}

beforeEach(() => {
  templates.getPublishedTemplateById.mockReset();
});

describe("new Studio page", () => {
  it("explains that a template without an artifact is coming soon and offers no draft (Template that is not yet available)", async () => {
    templates.getPublishedTemplateById.mockResolvedValue(summary);

    const html = await render("future-template");

    expect(html).toContain("Mẫu quà này sắp ra mắt.");
    expect(html).toContain("Mẫu quà tương lai");
    expect(html).toContain('href="/templates"');
    expect(html).not.toContain("Bắt đầu với template này");
  });

  it("offers a draft for an available template", async () => {
    templates.getPublishedTemplateById.mockResolvedValue({ ...summary, available: true });

    const html = await render("future-template");

    expect(templates.getPublishedTemplateById).toHaveBeenCalledWith("future-template");
    expect(html).toContain("Bắt đầu với Mẫu quà tương lai");
    // The draft is pinned to the exact current version of the summary.
    expect(html).toContain("Bắt đầu với template này future-template@1.0.0");
    expect(html).not.toContain("Mẫu quà này sắp ra mắt.");
  });

  it("asks to choose a template for an unknown or retired one", async () => {
    templates.getPublishedTemplateById.mockResolvedValue(undefined);

    const html = await render("midnight-wish");

    expect(html).toContain("Chọn template trước khi bắt đầu");
    expect(html).not.toContain("Bắt đầu với template này");
  });
});
