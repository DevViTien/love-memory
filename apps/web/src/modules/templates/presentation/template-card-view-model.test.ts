import { describe, expect, it } from "vitest";

import { toTemplateCardViewModel } from "./template-card-view-model";

describe("template card view model", () => {
  it("maps domain metadata to localized presentation values", () => {
    const viewModel = toTemplateCardViewModel({
      description: "Story",
      estimatedDurationSec: 75,
      id: "memory-box",
      imageRequirement: { maxItems: 8, minItems: 3 },
      moods: ["warm", "playful"],
      name: "Memory Box",
      available: true,
      version: "1.0.0",
    });

    expect(viewModel).toMatchObject({
      comingSoon: false,
      durationLabel: "Khoảng 75 giây",
      icon: "🎁",
      moodLabel: "Ấm áp · Bất ngờ",
      photoRequirement: "3–8 ảnh",
    });
  });

  it("uses safe fallbacks for newly introduced templates", () => {
    const viewModel = toTemplateCardViewModel({
      description: "Story",
      estimatedDurationSec: 60,
      id: "new-template",
      moods: ["new-mood"],
      name: "New",
      available: true,
      version: "1.0.0",
    });

    expect(viewModel).toMatchObject({
      icon: "💝",
      moodLabel: "new-mood",
      photoRequirement: "Không bắt buộc",
    });
  });

  it("marks a template without a registered artifact as coming soon", () => {
    const viewModel = toTemplateCardViewModel({
      available: false,
      description: "Story",
      estimatedDurationSec: 90,
      id: "midnight-wish",
      moods: ["dreamy"],
      name: "Bầu trời lời nhắn",
      version: "1.0.0",
    });

    expect(viewModel).toMatchObject({ comingSoon: true, icon: "✨" });
  });

  const memories = {
    available: true,
    description: "Sổ kỷ niệm",
    estimatedDurationSec: 120,
    id: "memories",
    imageRequirement: { maxItems: 15, minItems: 1 },
    moods: ["romantic"],
    name: "Kỷ niệm của chúng mình",
    thumbnailUrl: `/template-artifacts/memories/1.0.0/${"a".repeat(64)}/assets/thumbnail.jpg`,
    version: "1.0.0",
  };

  it("shows an html template's own thumbnail with a descriptive alt (Catalog thumbnail)", () => {
    expect(toTemplateCardViewModel(memories)).toMatchObject({
      icon: "📔",
      photoRequirement: "1–15 ảnh",
      thumbnail: {
        alt: "Hình minh họa mẫu quà Kỷ niệm của chúng mình",
        src: memories.thumbnailUrl,
      },
    });
  });

  it("shows an exact photo count when the range is a single number (Card of a one-photo template)", () => {
    expect(
      toTemplateCardViewModel({ ...memories, imageRequirement: { maxItems: 1, minItems: 1 } })
        .photoRequirement,
    ).toBe("1 ảnh");
  });

  it("keeps the gradient visual without a thumbnail or while the template is unavailable", () => {
    const { thumbnailUrl: _thumbnailUrl, ...withoutThumbnail } = memories;

    expect(toTemplateCardViewModel(withoutThumbnail).thumbnail).toBeNull();
    expect(toTemplateCardViewModel({ ...memories, available: false })).toMatchObject({
      comingSoon: true,
      thumbnail: null,
    });
  });
});
